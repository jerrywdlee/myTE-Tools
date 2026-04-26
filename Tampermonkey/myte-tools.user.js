// ==UserScript==
// @name         myTE Tools
// @namespace    https://github.com/jerrywdlee/myTE-Tools
// @version      1.4.3
// @description  Auto-fill myTE working hours with optional overtime synchronization.
// @author       Julia Lee (@jerrywdlee)
// @match        https://myte.accenture.com/*
// @match        https://avanade.sharepoint.com/teams/avanavi/myOT/Lists/myOT/NewForm*
// @homepageURL  https://github.com/jerrywdlee/myTE-Tools
// @supportURL   https://github.com/jerrywdlee/myTE-Tools/issues
// @downloadURL  https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
// @updateURL    https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/js-yaml@4.1.1/dist/js-yaml.min.js
// @require      https://cdn.jsdelivr.net/npm/marked@18.0.0/lib/marked.umd.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    "use strict";

    const UI_INTERVAL_MS = 500;
    const WORKING_GRID_SELECTOR = "#workingHoursPunchClockGrid .ag-row";
    const RUNTIME_PREFIX = "[myTE Tools]";
    const NOTICE_ID = "helper-running-notice";
    const NOTICE_ANIMATION_MS = 1000;
    const EMAIL_TEMPLATE_STORAGE_KEY = "myte-email-template-v1";
    const OVERTIME_HISTORY_STORAGE_KEY = "myte-overtime-history-v1";
    const OVERTIME_HISTORY_MAX = 12;
    const OVERTIME_FILL_FORM_STORAGE_KEY = "myte-ot-fill-form-v1";
    // const EMAIL_CAPTURE_SELECTOR = "div.content-wrap";
    const EMAIL_CAPTURE_SELECTOR = "myte-app";
    const EMAIL_TAB_STEPS = [
            { name: "Summary", cid: "cid-summary-image", tabId: "summary" },
            { name: "Time", cid: "cid-time-image", tabId: "time" },
            { name: "Expenses", cid: "cid-expenses-image", tabId: "expenses" },
            { name: "Adjustments", cid: "cid-adjustments-image", tabId: "adjustments" },
    ];
    const DEFAULT_EMAIL_TEMPLATE = `---
from: 'from@example.com'
to: 'to@example.com'
cc:
    - 'cc@example.com'
    - 'cc2@example.com'
subject: '[myTE] Period {{period}} Approval Request'
---

Dear Team,

This is a reminder to submit your working hours for this week. 

## Summary
{{Summary}}
## Time
{{Time}}
## Expenses
{{Expenses}}
## Adjustments
{{Adjustments}}

Best regards,
`;
    const VACATION_CODES = [
      '900X00', // Regular Vacation
      '917X00', // Maternity Leave
      '950X00', // Personal Illness
      '983X00', // Z Unpaid Absence
      '984X00', // Childecare Leave_Unpaid
      '999X00', // Flex Time
      '140Z01', // Female Leave_Paid
      '140Z02', // Female Leave_Unpaid
      '140Z03', // Medical Exam
      '731Z21', // Marrage Leave
      '734Z21', // Mother's Welfare Leave
      '735Z22', // Mother's Welfare Leave Hospital
        ];

    function logStatus(message) {
        console.log(`${RUNTIME_PREFIX} ${message}`);
        const status = document.getElementById("helper-status");
        if (status) {
            status.innerText = message;
        }
    }

    function setRunningNotice(message, variant = "running", autoHideMs = 4000) {
        let notice = document.getElementById(NOTICE_ID);

        if (!message) {
            if (notice) {
                if (notice._hideTimer) {
                    clearTimeout(notice._hideTimer);
                    notice._hideTimer = null;
                }
                if (notice._removeTimer) {
                    clearTimeout(notice._removeTimer);
                    notice._removeTimer = null;
                }
                notice.remove();
            }
            return;
        }

        if (!notice) {
            notice = document.createElement("div");
            notice.id = NOTICE_ID;
            document.body.appendChild(notice);
        }

        const palette = {
            running: { bg: "#1f1f1f", fg: "#ffffff", border: "#3b3b3b" },
            success: { bg: "#4caf50", fg: "#ffffff", border: "#2e7d32" },
            error: { bg: "#f44336", fg: "#ffffff", border: "#b71c1c" },
        };
        const colors = palette[variant] || palette.running;

        notice.style = `position:fixed; top:20px; right:20px; width:auto; min-width:400px; padding:12px 18px; border-radius:10px; color:${colors.fg}; font-family:sans-serif; font-size:14px; font-weight:bold; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:1000000; transform:translateY(20px); opacity:0; transition:opacity 200ms ease, transform ${NOTICE_ANIMATION_MS}ms ease; background:${colors.bg}; border-left:6px solid ${colors.border};`;
        notice.innerHTML = `<div id="helper-status">${message}</div>`;

        if (notice._hideTimer) {
            clearTimeout(notice._hideTimer);
            notice._hideTimer = null;
        }
        if (notice._removeTimer) {
            clearTimeout(notice._removeTimer);
            notice._removeTimer = null;
        }

        setTimeout(() => {
            if (!document.getElementById(NOTICE_ID)) {
                return;
            }

            notice.style.opacity = "0.95";
            notice.style.transform = "translateY(0)";
        }, 10);

        if (autoHideMs > 0) {
            const duration = Math.max(1000, autoHideMs);
            notice._hideTimer = setTimeout(() => {
                notice.style.opacity = "0";
                notice.style.transform = "translateY(-20px)";
                notice._removeTimer = setTimeout(() => {
                    notice.remove();
                }, NOTICE_ANIMATION_MS);
            }, Math.max(0, duration - NOTICE_ANIMATION_MS));
        }
    }

    function getOvertimeMap() {
        const overtimeMap = {};
        const rows = Array.from(document.querySelectorAll(".ag-row"));
        const overtimeRow = rows.find((row) =>
            row.querySelector('[col-id="CategoryDescription"]')?.innerText.includes("Daily Overtime"),
        );

        if (!overtimeRow) {
            console.error(`${RUNTIME_PREFIX} Could not find Daily Overtime row in DOM`);
            return overtimeMap;
        }

        for (let i = 0; i <= 14; i += 1) {
            const colId = `Date${i}`;
            const cell = overtimeRow.querySelector(`[col-id="${colId}"]`);
            if (!cell) {
                continue;
            }

            const valueSpan = cell.querySelector('span[aria-hidden="true"]');
            const value = parseFloat(valueSpan?.innerText || "0") || 0;
            const header = document.querySelector(`.ag-header-cell[col-id="${colId}"]`);
            const dateNumMatch = header?.innerText.match(/\d+/);

            if (dateNumMatch) {
                const dayKey = dateNumMatch[0].padStart(2, "0");
                overtimeMap[dayKey] = value;
            }
        }

        console.log(`${RUNTIME_PREFIX} Parsed Overtime Map:`, overtimeMap);
        return overtimeMap;
    }

    function saveOvertimeHistory(period, overtimeMap) {
        const periodText = String(period || "").trim();
        if (!periodText) {
            return 0;
        }

        const stored = gmGetValueSafe(OVERTIME_HISTORY_STORAGE_KEY, []);
        const history = Array.isArray(stored) ? stored.slice() : [];

        const nextHistory = history.filter((item) => {
            if (!item || typeof item !== "object") {
                return false;
            }
            if (typeof item.period !== "string") {
                return false;
            }
            return item.period !== periodText;
        });

        nextHistory.push({
            period: periodText,
            overtimeMap: overtimeMap && typeof overtimeMap === "object" ? { ...overtimeMap } : {},
            savedAt: Date.now(),
        });

        const trimmedHistory = nextHistory.slice(-OVERTIME_HISTORY_MAX);
        gmSetValueSafe(OVERTIME_HISTORY_STORAGE_KEY, trimmedHistory);
        return trimmedHistory.length;
    }

    function getOvertimeHistoryNewestFirst() {
        const stored = gmGetValueSafe(OVERTIME_HISTORY_STORAGE_KEY, []);
        const history = Array.isArray(stored) ? stored.slice() : [];

        return history
            .filter((item) => item && typeof item === "object" && typeof item.period === "string")
            .sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
    }

    function getSavedOvertimeFillForm() {
        const saved = gmGetValueSafe(OVERTIME_FILL_FORM_STORAGE_KEY, {});
        if (!saved || typeof saved !== "object") {
            return {
                projectDesc: "",
                wbs: "",
                reason: "",
            };
        }

        return {
            projectDesc: String(saved.projectDesc || ""),
            wbs: String(saved.wbs || ""),
            reason: String(saved.reason || ""),
        };
    }

    function saveOvertimeFillForm(formValues) {
        const payload = {
            projectDesc: String(formValues?.projectDesc || ""),
            wbs: String(formValues?.wbs || ""),
            reason: String(formValues?.reason || ""),
        };
        gmSetValueSafe(OVERTIME_FILL_FORM_STORAGE_KEY, payload);
    }

    function getVacationDaySet() {
        const vacationDays = new Set();
        const rows = Array.from(document.querySelectorAll(".ag-row"));
        const vacationRows = rows.filter((row) => {
          const categoryText = row.querySelector('[col-id="Assignment"]')?.innerText || "";
            console.log(`Checking row for vacation codes:`, categoryText);
            return VACATION_CODES.some((code) => categoryText.includes(code));
        });

        for (const row of vacationRows) {
            for (let i = 0; i <= 14; i += 1) {
                const colId = `Date${i}`;
                const cell = row.querySelector(`[col-id="${colId}"]`);
                if (!cell) {
                    continue;
                }

                const normalizedValue = (cell.innerText || "").replace(/\s+/g, "").replace(/,/g, "");
                const isEmpty = normalizedValue === "";
                const numericValue = Number(normalizedValue);
                const isZero = !isEmpty && !Number.isNaN(numericValue) && numericValue === 0;

                if (isEmpty || isZero) {
                    continue;
                }

                const header = document.querySelector(`.ag-header-cell[col-id="${colId}"]`);
                const dateNumMatch = header?.innerText.match(/\d+/);
                if (dateNumMatch) {
                    vacationDays.add(dateNumMatch[0].padStart(2, "0"));
                }
            }
        }

        console.log(`${RUNTIME_PREFIX} Parsed Vacation Days:`, Array.from(vacationDays));
        return vacationDays;
    }

    function smartSelect(selectEl, targetValue) {
        if (!selectEl) {
            return;
        }

        const parsed = parseInt(targetValue, 10);
        const valueStr = Number.isNaN(parsed) ? String(targetValue) : String(parsed);
        const valuePad = valueStr.padStart(2, "0");

        for (const option of selectEl.options) {
            if (option.value === valueStr || option.value === valuePad) {
                selectEl.value = option.value;
                break;
            }
        }

        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setSelectValue(selectEl, value) {
        if (!selectEl) {
            return;
        }

        selectEl.value = String(value);
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function waitForSelector(selector, timeout = 10000, root = document) {
        return new Promise((resolve, reject) => {
            const element = root.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const nextElement = root.querySelector(selector);
                if (nextElement) {
                    observer.disconnect();
                    resolve(nextElement);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            const timerId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout: "${selector}" not found`));
            }, timeout);

            observer.takeRecords();
            Promise.resolve().then(() => {
                const nextElement = root.querySelector(selector);
                if (nextElement) {
                    clearTimeout(timerId);
                    observer.disconnect();
                    resolve(nextElement);
                }
            });
        });
    }

    async function fillCellPrecision(row, colId, hour, minute) {
        const cell = row.querySelector(`[col-id="${colId}"]`);
        if (!cell) {
            return;
        }

        const selects = cell.querySelectorAll("select");
        if (selects.length >= 2) {
            smartSelect(selects[0], hour);
            smartSelect(selects[1], minute);
        }
    }

    function getWorkdayTexts() {
        return Array.from(document.querySelectorAll(WORKING_GRID_SELECTOR))
            .map((row) => {
                const dateCell = row.querySelector('[col-id="dateTime"]');
                if (!dateCell) {
                    return null;
                }

                const dateText = dateCell.innerText.trim();
                const isSpecialDay =
                    dateCell.querySelector(".special-cell") !== null ||
                    dateCell.classList.contains("special-cell");

                if (dateText.length <= 5 || isSpecialDay) {
                    return null;
                }

                return dateText;
            })
            .filter(Boolean);
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function gmGetValueSafe(key, defaultValue) {
        try {
            if (typeof GM_getValue === "function") {
                return GM_getValue(key, defaultValue);
            }
        } catch (error) {
            console.warn(`${RUNTIME_PREFIX} GM_getValue failed:`, error);
        }
        return defaultValue;
    }

    function gmSetValueSafe(key, value) {
        try {
            if (typeof GM_setValue === "function") {
                GM_setValue(key, value);
                return;
            }
        } catch (error) {
            console.warn(`${RUNTIME_PREFIX} GM_setValue failed:`, error);
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function parseTemplateFrontMatter(templateText) {
        const source = String(templateText || "");
        const normalized = source.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");

        if (lines[0]?.trim() !== "---") {
            return { meta: {}, body: normalized };
        }

        const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
        if (closingIndex < 0) {
            return { meta: {}, body: normalized };
        }

        const yamlPart = lines.slice(1, closingIndex).join("\n");
        const bodyPart = lines.slice(closingIndex + 1).join("\n");
        let meta = {};
        try {
            meta = typeof jsyaml !== "undefined" ? jsyaml.load(yamlPart) || {} : {};
        } catch (error) {
            throw new Error(`Invalid YAML frontmatter: ${error.message}`);
        }

        if (!Array.isArray(meta.cc)) {
            if (typeof meta.cc === "string" && meta.cc.trim()) {
                meta.cc = meta.cc
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean);
            } else {
                meta.cc = [];
            }
        }

        return { meta, body: bodyPart };
    }

    function markdownToHtml(markdown) {
        if (typeof marked === "undefined") {
            return `<p>${escapeHtml(markdown || "")}</p>`;
        }

        return marked.parse(String(markdown || ""));
    }

    function markdownToPlainText(markdown) {
        return String(markdown || "")
            .replace(/\r\n/g, "\n")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
            .replace(/^#{1,6}\s*/gm, "")
            .replace(/^[-*]\s+/gm, "- ")
            .trim();
    }

    function getSavedEmailTemplate() {
        return gmGetValueSafe(EMAIL_TEMPLATE_STORAGE_KEY, DEFAULT_EMAIL_TEMPLATE) || DEFAULT_EMAIL_TEMPLATE;
    }

    function getPeriodFromPage() {
        const periodElement = document.querySelector("div.item.active");
        if (!periodElement) {
            return "UnknownPeriod";
        }

        const text = periodElement.innerText.trim();
        const matched = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (!matched) {
            return text || "UnknownPeriod";
        }

        const year = matched[1];
        const month = matched[2].padStart(2, "0");
        const day = matched[3].padStart(2, "0");
        return `${year}/${month}/${day}`;
    }

    async function capturePageAsBase64Png() {
        if (typeof html2canvas !== "function") {
            throw new Error("html2canvas is not available");
        }

        const target = document.querySelector(EMAIL_CAPTURE_SELECTOR);
        if (!target) {
            throw new Error(`Capture target not found: ${EMAIL_CAPTURE_SELECTOR}`);
        }

        await sleep(50);

        const canvas = await html2canvas(target, {
            scale: 1.3,
            useCORS: true,
            logging: false,
            // backgroundColor: "#ffffff",
        });
        const dataUrl = canvas.toDataURL("image/png");
        return dataUrl.split(",")[1];
    }

    async function captureEmailScreenshots() {
        const results = [];

        for (const step of EMAIL_TAB_STEPS) {
            const tab = document.getElementById(step.tabId);
            if (tab) {
                tab.click();
            }

            console.log(`${RUNTIME_PREFIX} Navigated to ${step.name} tab, waiting for content to load...`);

            await sleep(1500);
            // await waitForSelector(EMAIL_CAPTURE_SELECTOR, 2000); // Very bad idea
            let time = new Date().getTime();
            console.log(`Capture start ${step.name}`);
            const base64 = await capturePageAsBase64Png();
            console.log(`Capture end ${step.name}, duration: ${new Date().getTime() - time}ms`);
            results.push({ ...step, base64 });
        }

        const defaultTab = document.getElementById(EMAIL_TAB_STEPS[1].tabId);
        if (defaultTab) {
            defaultTab.click();
        }

        return results;
    }

    function wrapBase64ForMime(base64) {
        return String(base64 || "").replace(/(.{76})/g, "$1\r\n");
    }

    function buildEmailBodies(templateBody, screenshotResults) {
        let htmlTemplate = String(templateBody || "");
        let plainTemplate = String(templateBody || "");

        for (const item of screenshotResults) {
            const token = `{{${item.name}}}`;
            const imageHtml = `\n<div style="text-align:center; margin:16px 0;"><img style="display:inline-block; width:80%; max-width:1400px; height:auto;" alt="${item.name}" src="cid:${item.cid}"></div>\n`;
            htmlTemplate = htmlTemplate.split(token).join(imageHtml);
            plainTemplate = plainTemplate.split(token).join(`[${item.name}: cid:${item.cid}]`);
        }

        let htmlBody = markdownToHtml(htmlTemplate);

        return {
            plainBody: markdownToPlainText(plainTemplate),
            htmlBody,
        };
    }

    function buildEmlText(meta, plainBody, htmlBody, screenshotResults) {
        const boundaryRelated = `_rel_${Date.now()}`;
        const boundaryAlt = `_alt_${Date.now()}`;
        const dateHeader = new Date().toUTCString();
        const from = meta.from || "";
        const to = meta.to || "";
        const cc = Array.isArray(meta.cc) ? meta.cc.filter(Boolean) : [];
        const subject = meta.subject || "[myTE] Period Approval Request";

        let eml = "";
        eml += `From: ${from}\r\n`;
        eml += `To: ${to}\r\n`;
        if (cc.length > 0) {
            eml += `CC: ${cc.join(", ")}\r\n`;
        }
        eml += `Subject: ${subject}\r\n`;
        eml += `Date: ${dateHeader}\r\n`;
        eml += "MIME-Version: 1.0\r\n";
        eml += `Content-Type: multipart/related; boundary="${boundaryRelated}"; type="multipart/alternative"\r\n`;
        eml += "Content-Language: en-US\r\n\r\n";

        eml += `--${boundaryRelated}\r\n`;
        eml += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n\r\n`;

        eml += `--${boundaryAlt}\r\n`;
        eml += 'Content-Type: text/plain; charset="utf-8"\r\n\r\n';
        eml += `${plainBody}\r\n`;

        eml += `--${boundaryAlt}\r\n`;
        eml += 'Content-Type: text/html; charset="utf-8"\r\n\r\n';
        eml += `<html><body>${htmlBody}</body></html>\r\n`;
        eml += `--${boundaryAlt}--\r\n`;

        for (const item of screenshotResults) {
            eml += `--${boundaryRelated}\r\n`;
            eml += `Content-Type: image/png; name="${item.name}.png"\r\n`;
            eml += `Content-Description: ${item.name}.png\r\n`;
            eml += `Content-Disposition: inline; filename="${item.name}.png"\r\n`;
            eml += `Content-ID: <${item.cid}>\r\n`;
            eml += "Content-Transfer-Encoding: base64\r\n\r\n";
            eml += `${wrapBase64ForMime(item.base64)}\r\n`;
        }

        eml += `--${boundaryRelated}--\r\n`;
        return eml;
    }

    function downloadEml(filename, emlText) {
        const blob = new Blob([emlText], { type: "message/rfc822" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function buildEmailDialogContent(templateValue) {
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:8px;">
                <div style="font-weight:bold; color:#7500c0; font-size:15px;">Email Template:</div>
                <button id="btn-close-email-dialog" style="width:24px; height:24px; border:none; background:transparent; color:#7500c0; font-size:28px; cursor:pointer; line-height:1;" title="Close">&times;</button>
            </div>
            <div style="margin-bottom:14px;">
                <textarea id="email-template-input" style="width:100%; height:280px; resize:vertical; border:1px solid #7500c0; border-radius:4px; padding:8px; font-family:Consolas, monospace; font-size:12px; box-sizing:border-box;">${escapeHtml(templateValue)}</textarea>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
                <button id="btn-reset-template" style="width:100%; background:white; color:#7500c0; border:1px solid #7500c0; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">Reset Template</button>
                <button id="btn-download-email" style="width:100%; background:#7500c0; color:white; border:none; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">Downlowd Email</button>
                <button id="btn-copy-email-content" style="width:100%; background:#ff6d00; color:white; border:none; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">Copy Content</button>
            </div>
        `;
    }

    function setEmailActionButtonsDisabled(disabled) {
        const dialog = document.getElementById("myte-email-dialog");
        if (!dialog) {
            return;
        }
        ["#email-template-input", "#btn-reset-template", "#btn-copy-email-content", "#btn-download-email"].forEach((selector) => {
            const element = dialog.querySelector(selector);
            if (element) {
                element.disabled = disabled;
            }
        });
    }

    function normalizeHtmlToPlainText(rawContent) {
        const normalized = String(rawContent || "")
            .trim()
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<div[^>]*>/gi, "\n")
            .replace(/<\/div>/gi, "")
            .replace(/<p[^>]*>/gi, "\n")
            .replace(/<\/p>/gi, "")
            .replace(/&nbsp;/gi, " ");

        const plain = normalized.replace(/<[^>]+>/g, "");
        const decoder = document.createElement("textarea");
        decoder.innerHTML = plain;
        return decoder.value;
    }

    function copyHtmlAndPlainToClipboard(rawHtml) {
        if (typeof GM_setClipboard !== "function") {
            throw new Error("GM_setClipboard is not available");
        }

        const plain = normalizeHtmlToPlainText(rawHtml);
        const stablePlain = plain.replace(/^$/gm, " ");
        const html = `<div style="font-family: sans-serif; line-height: 1.6;">${rawHtml}</div>`;

        try {
            GM_setClipboard(stablePlain, { type: "text", mimetype: "text/plain" });
        } catch (error) {
            GM_setClipboard(stablePlain, "text");
        }

        try {
            GM_setClipboard(html, { type: "html", mimetype: "text/html" });
        } catch (error) {
            GM_setClipboard(html, "html");
        }
    }

    async function copyEmailContentFromTemplate() {
        const templateInput = document.getElementById("email-template-input");
        const rawTemplate = templateInput?.value || DEFAULT_EMAIL_TEMPLATE;
        const parsed = parseTemplateFrontMatter(rawTemplate);

        // Keep the same flow as email download: capture screenshots first,
        // then compose the final body content from the template.
        const screenshots = await captureEmailScreenshots();
        const bodies = buildEmailBodies(parsed.body, screenshots);

        // Replace cid: references with inline data URIs for clipboard
        let clipboardHtml = bodies.htmlBody;
        for (const item of screenshots) {
            clipboardHtml = clipboardHtml.split(`cid:${item.cid}`).join(`data:image/png;base64,${item.base64}`);
        }
        copyHtmlAndPlainToClipboard(clipboardHtml);
    }

    async function generateEmailFromTemplate() {
        const templateInput = document.getElementById("email-template-input");
        const rawTemplate = templateInput?.value || DEFAULT_EMAIL_TEMPLATE;

        const parsed = parseTemplateFrontMatter(rawTemplate);
        const period = getPeriodFromPage();
        const subjectPeriod =
            document.querySelector("#comboboxselect-period-dropdown .active")?.textContent?.trim() || period;
        const displayName = parsed.meta.displayName || "myTE User";
        const subjectTemplate = parsed.meta.subject || `[myTE] ${period} Period Approval Request from ${displayName}`;
        const subject = String(subjectTemplate).replace(/\{\{\s*period\s*\}\}/gi, subjectPeriod);
        const screenshots = await captureEmailScreenshots();
        const bodies = buildEmailBodies(parsed.body, screenshots);

        const eml = buildEmlText(
            {
                from: parsed.meta.from || "",
                to: parsed.meta.to || "",
                cc: parsed.meta.cc || [],
                subject,
            },
            bodies.plainBody,
            bodies.htmlBody,
            screenshots,
        );

        const filename = `[myTE] ${period} Period Approval Request from ${displayName}.eml`;
        downloadEml(filename, eml);
    }

    function getOrCreateEmailDialog() {
        let dialog = document.getElementById("myte-email-dialog");
        if (dialog) {
            const templateInput = dialog.querySelector("#email-template-input");
            if (templateInput && !templateInput.value.trim()) {
                templateInput.value = getSavedEmailTemplate();
            }
            return dialog;
        }

        dialog = document.createElement("dialog");
        dialog.id = "myte-email-dialog";
        dialog.style =
            "border:3px solid #7500c0; padding:18px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.4); width:760px; max-width:min(92vw, 760px); font-family:sans-serif; font-size:13px; background:white; color:#1f1f1f;";
        dialog.innerHTML = buildEmailDialogContent(getSavedEmailTemplate());
        document.body.appendChild(dialog);

        const closeButton = dialog.querySelector("#btn-close-email-dialog");
        const resetButton = dialog.querySelector("#btn-reset-template");
        const copyButton = dialog.querySelector("#btn-copy-email-content");
        const downloadButton = dialog.querySelector("#btn-download-email");
        const templateInput = dialog.querySelector("#email-template-input");

        if (closeButton) {
            closeButton.onclick = () => dialog.close();
        }

        if (resetButton && templateInput) {
            resetButton.onclick = () => {
                templateInput.value = DEFAULT_EMAIL_TEMPLATE;
                gmSetValueSafe(EMAIL_TEMPLATE_STORAGE_KEY, DEFAULT_EMAIL_TEMPLATE);
            };
        }

        if (templateInput) {
            templateInput.addEventListener("blur", () => {
                gmSetValueSafe(EMAIL_TEMPLATE_STORAGE_KEY, templateInput.value || DEFAULT_EMAIL_TEMPLATE);
            });
        }

        if (copyButton) {
            copyButton.onclick = async () => {
                setEmailActionButtonsDisabled(true);
                setRunningNotice("Generating screenshots and copying email body...", "running", 0);
                try {
                    await copyEmailContentFromTemplate();
                    setRunningNotice("");
                    setRunningNotice("Email body copied.", "success", 1800);
                    alert("Email body copied to clipboard.");
                } catch (error) {
                    console.error(`${RUNTIME_PREFIX} Email content copy failed:`, error);
                    setRunningNotice("");
                    setRunningNotice("Email content copy failed. Check console.", "error", 2600);
                } finally {
                    setEmailActionButtonsDisabled(false);
                }
            };
        }

        if (downloadButton) {
            downloadButton.onclick = async () => {
                setEmailActionButtonsDisabled(true);
                setRunningNotice("Generating email and screenshots...", "running", 0);
                try {
                    await generateEmailFromTemplate();
                    setRunningNotice("");
                    setRunningNotice("Email downloaded.", "success", 1800);
                } catch (error) {
                    console.error(`${RUNTIME_PREFIX} Email generation failed:`, error);
                    setRunningNotice("");
                    setRunningNotice("Email generation failed. Check console.", "error", 2600);
                } finally {
                    setEmailActionButtonsDisabled(false);
                }
            };
        }

        return dialog;
    }

    async function clickSaveIfAvailable() {
        const buttons = Array.from(document.querySelectorAll("button"));
        const saveButton = buttons.find((button) => button.innerText.trim() === "Save");

        if (!saveButton || saveButton.disabled) {
            return false;
        }

        saveButton.click();
        await sleep(2000);
        return true;
    }

    function setDialogControlsDisabled(disabled) {
        const dialog = document.getElementById("myte-tools-dialog");
        if (!dialog) {
            return;
        }
        dialog.querySelectorAll("input, select, button").forEach((el) => {
            el.disabled = disabled;
        });
    }

    async function startProcess() {
        setDialogControlsDisabled(true);
        setRunningNotice("myTE Auto-Filler is running...", "running", 0);
        await sleep(200);
        logStatus("Starting auto fill...",);

        try {
            const syncOt = document.getElementById("sync-ot")?.checked;
            const skipVacations = document.getElementById("skip-vacations")?.checked;
            const overtimeMap = syncOt ? getOvertimeMap() : {};
            const period = getPeriodFromPage();

            if (syncOt) {
                const savedCount = saveOvertimeHistory(period, overtimeMap);
                setRunningNotice(`Overtime record saved (${savedCount}/${OVERTIME_HISTORY_MAX})`, "success", 1800);
                await sleep(250);
                setRunningNotice("myTE Auto-Filler is running...", "running", 0);
            }

            const vacationDays = skipVacations ? getVacationDaySet() : new Set();

            const baseR2End = parseInt(document.getElementById("in-r2e")?.value || "18", 10);
            const values = {
                ws: document.getElementById("in-ws")?.value || "9",
                we: document.getElementById("in-we")?.value || "12",
                bs: document.getElementById("in-bs")?.value || "12",
                be: document.getElementById("in-be")?.value || "13",
                r2s: document.getElementById("in-r2s")?.value || "13",
            };

            const workdays = getWorkdayTexts();

            for (const dateText of workdays) {
                const dayMatch = dateText.match(/\d+$/);
                const dayKey = dayMatch ? dayMatch[0].padStart(2, "0") : null;

                if (dayKey && vacationDays.has(dayKey)) {
                    logStatus(`Skipping ${dateText} | Vacation`);
                    continue;
                }

                const overtime = overtimeMap[dayKey] || 0;

                logStatus(`Processing ${dateText} | OT: ${overtime}h`);

                let allRows = Array.from(document.querySelectorAll(WORKING_GRID_SELECTOR));
                let row1 = allRows.find((row) =>
                    row.querySelector('[col-id="dateTime"]')?.innerText.includes(dateText),
                );
                if (!row1) {
                    continue;
                }

                await fillCellPrecision(row1, "workStartTime", values.ws, "0");
                await fillCellPrecision(row1, "workEndTime", values.we, "0");
                await fillCellPrecision(row1, "mealStartTime", values.bs, "0");
                await fillCellPrecision(row1, "mealEndTime", values.be, "0");

                let nextRow = row1.nextElementSibling;
                const hasRow2 =
                    nextRow &&
                    (!nextRow.querySelector('[col-id="dateTime"]') ||
                        nextRow.querySelector('[col-id="dateTime"]').innerText.trim() === "");

                if (!hasRow2) {
                    const addButton = row1.querySelector("button.action-button.add");
                    if (addButton) {
                        addButton.click();
                        await sleep(400);
                        allRows = Array.from(document.querySelectorAll(WORKING_GRID_SELECTOR));
                        row1 = allRows.find((row) =>
                            row.querySelector('[col-id="dateTime"]')?.innerText.includes(dateText),
                        );
                    }
                }

                const row2 = row1?.nextElementSibling;
                if (row2) {
                    const finalHour = baseR2End + Math.floor(overtime);
                    const finalMin = Math.round((overtime % 1) * 60);
                    await fillCellPrecision(row2, "workStartTime", values.r2s, "0");
                    await fillCellPrecision(row2, "workEndTime", String(finalHour), String(finalMin));
                }
            }

            logStatus("SUCCESS!");
            setRunningNotice("Done!", "success", 1800);

            const dialog = document.getElementById("myte-tools-dialog");

            const dataConf = dialog?.dataset.conf ? JSON.parse(dialog.dataset.conf) : {};
            if (!!dataConf.autoSave) {
                await sleep(300);
                await clickSaveIfAvailable();
             }

            if (dialog?.open) {
                dialog.close();
            }
        } catch (error) {
            console.error(`${RUNTIME_PREFIX} Auto fill failed:`, error);
            logStatus("Failed. Check console.");
            setRunningNotice("Failed. Check console.", "error", 2500);
        } finally {
            setDialogControlsDisabled(false);
        }
    }

    async function resetHoursProcess() {
        setDialogControlsDisabled(true);
        setRunningNotice("myTE hour entries are being reset...", "running", 0);
        logStatus("Starting reset...");

        try {
            await waitForSelector(WORKING_GRID_SELECTOR);

            const rows = Array.from(document.querySelectorAll(WORKING_GRID_SELECTOR));
            let clearedRowCount = 0;

            for (const row of rows) {
                const dateCell = row.querySelector('[col-id="dateTime"]');
                if (!dateCell) {
                    continue;
                }

                let rowChanged = false;
                const selects = row.querySelectorAll("select");

                for (const selectEl of selects) {
                    const firstOption = selectEl.options[0];
                    const resetValue = firstOption ? firstOption.value : "";
                    if (selectEl.value !== resetValue) {
                        setSelectValue(selectEl, resetValue);
                        rowChanged = true;
                    }
                }

                if (rowChanged) {
                    clearedRowCount += 1;
                    await sleep(50);
                }
            }

            logStatus(`Reset complete: ${clearedRowCount} rows`);
            setRunningNotice(`Reset complete: ${clearedRowCount} rows`, "success", 2200);

            const dialog = document.getElementById("myte-tools-dialog");

            const dataConf = dialog?.dataset.conf ? JSON.parse(dialog.dataset.conf) : {};
            if (!!dataConf.autoSave) {
                await sleep(300);
                await clickSaveIfAvailable();
            }

            if (dialog?.open) {
              dialog.close();
            }
        } catch (error) {
            console.error(`${RUNTIME_PREFIX} Reset hours failed:`, error);
            logStatus("Reset failed. Check console.");
            setRunningNotice("Reset failed. Check console.", "error", 2500);
        } finally {
            setDialogControlsDisabled(false);
        }
    }

    function buildDialogContent() {
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:8px;">
                <div style="font-weight:bold; color:#7500c0; font-size:15px;">myTE Auto-Filler</div>
                <button id="btn-close-dialog" style="width:24px; height:24px; border:none; background:transparent; color:#7500c0; font-size:18px; cursor:pointer; line-height:1;" title="Close">&times;</button>
            </div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;"><span style="min-width:72px;">Work:</span><span style="display:flex; align-items:center; gap:8px;"><input type="text" id="in-ws" value="9" style="width:48px; text-align:center;"> <span>-</span> <input type="text" id="in-we" value="12" style="width:48px; text-align:center;"></span></div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;"><span style="min-width:72px;">Break:</span><span style="display:flex; align-items:center; gap:8px;"><input type="text" id="in-bs" value="12" style="width:48px; text-align:center;"> <span>-</span> <input type="text" id="in-be" value="13" style="width:48px; text-align:center;"></span></div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;"><span style="min-width:72px;">Work:</span><span style="display:flex; align-items:center; gap:8px;"><input type="text" id="in-r2s" value="13" style="width:48px; text-align:center;"> <span>-</span> <input type="text" id="in-r2e" value="18" style="width:48px; text-align:center;"></span></div>
            </div>
            <div style="margin-bottom:10px; padding:8px; background:#f4f0ff; border-radius:6px;">
                <label style="cursor:pointer; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="sync-ot" checked><span style="font-weight:bold; color:#7500c0;">Auto-sync Overtime</span></label>
                <br/>
                <label style="cursor:pointer; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="skip-vacations" checked><span style="font-weight:bold; color:#7500c0;">Skip Vacations</span></label>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <button id="btn-reset-hours" style="width:100%; background:white; color:#7500c0; border:1px solid #7500c0; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">RESET HOURS</button>
                <button id="btn-start-fill" style="width:100%; background:#7500c0; color:white; border:none; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">START FILLING</button>
            </div>
        `;
    }

    function buildOvertimeFillDialogContent(periodOptions, formValues) {
        const periodOptionsHtml = periodOptions.length > 0
            ? periodOptions
                  .map((period, index) => `<option value="${escapeHtml(period)}"${index === 0 ? " selected" : ""}>${escapeHtml(period)}</option>`)
                  .join("")
            : '<option value="">No Overtime History</option>';

        return `
            <div style="position:relative; display:flex; align-items:center; gap:12px; margin-bottom:12px; border-bottom:1px solid #f2d4b8; padding:0 34px 8px 0;">
                <div style="font-weight:700; color:#c24e00; font-size:16px; font-family:'Segoe UI', sans-serif;">Fill Overtime:</div>
                <button id="btn-close-ot-fill-dialog" style="position:absolute; top:-2px; right:0; min-width:15px; height:24px; border:none; background:transparent; color:#a24300; font-size:20px; cursor:pointer; line-height:1; padding:0;" title="Close">&times;</button>
            </div>
            <div style="display:grid; grid-template-columns:108px 1fr; align-items:center; row-gap:10px; column-gap:12px; margin-bottom:14px; font-family:'Segoe UI', sans-serif; font-size:13px; color:#6b4a2f;">
                <label for="ot-fill-period">Period:</label>
                <select id="ot-fill-period" style="height:36px; padding:0 10px; border:2px solid #d39d73; border-radius:8px; color:#3f2b1a; font-size:13px;">${periodOptionsHtml}</select>

                <label for="ot-fill-project-desc">Project desc:</label>
                <input id="ot-fill-project-desc" type="text" value="${escapeHtml(formValues.projectDesc)}" placeholder="Current Proj" style="height:36px; padding:0 10px; border:2px solid #d39d73; border-radius:8px; color:#3f2b1a; font-size:13px;" />

                <label for="ot-fill-wbs">WBS:</label>
                <input id="ot-fill-wbs" type="text" value="${escapeHtml(formValues.wbs)}" placeholder="WBS Code" style="height:36px; padding:0 10px; border:2px solid #d39d73; border-radius:8px; color:#3f2b1a; font-size:13px;" />

                <label for="ot-fill-reason" style="align-self:start; padding-top:6px;">Reason:</label>
                <textarea id="ot-fill-reason" placeholder="Reason..." style="height:96px; resize:vertical; padding:8px 10px; border:2px solid #d39d73; border-radius:16px; color:#3f2b1a; font-size:13px; font-family:'Segoe UI', sans-serif;">${escapeHtml(formValues.reason)}</textarea>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button id="btn-clear-ot-fill" style="width:100%; background:#ffffff; color:#7c3c10; border:2px solid #d39d73; padding:9px; cursor:pointer; border-radius:8px; font-weight:700; font-size:14px;">Clear</button>
                <button id="btn-run-ot-fill" style="width:100%; background:#ff7a00; color:white; border:2px solid #ff7a00; padding:9px; cursor:pointer; border-radius:8px; font-weight:700; font-size:14px;">Fill</button>
            </div>
        `;
    }

    function setFieldValueWithEvents(element, value) {
        if (!element) {
            return;
        }

        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    function formatMyOtDate(period, dayNum) {
        const periodText = String(period || "").trim();
        const day = parseInt(String(dayNum || ""), 10);
        const matched = periodText.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);

        if (!matched || Number.isNaN(day)) {
            return "";
        }

        const year = parseInt(matched[1], 10);
        const month = parseInt(matched[2], 10);
        return `${month}/${day}/${year}`;
    }

    function refreshOvertimeFillDialogFields(dialog) {
        if (!dialog) {
            return;
        }

        const history = getOvertimeHistoryNewestFirst();
        const periodOptions = history.map((item) => item.period);
        const formValues = getSavedOvertimeFillForm();
        dialog.innerHTML = buildOvertimeFillDialogContent(periodOptions, formValues);

        const closeBtn = dialog.querySelector("#btn-close-ot-fill-dialog");
        const clearBtn = dialog.querySelector("#btn-clear-ot-fill");
        const fillBtn = dialog.querySelector("#btn-run-ot-fill");
        const projectDescInput = dialog.querySelector("#ot-fill-project-desc");
        const wbsInput = dialog.querySelector("#ot-fill-wbs");
        const reasonInput = dialog.querySelector("#ot-fill-reason");
        const periodSelect = dialog.querySelector("#ot-fill-period");

        const persistFormFields = () => {
            saveOvertimeFillForm({
                projectDesc: projectDescInput?.value || "",
                wbs: wbsInput?.value || "",
                reason: reasonInput?.value || "",
            });
        };

        [projectDescInput, wbsInput, reasonInput].forEach((field) => {
            if (field) {
                field.addEventListener("blur", persistFormFields);
            }
        });

        if (closeBtn) {
            closeBtn.onclick = () => dialog.close();
        }

        if (clearBtn) {
            clearBtn.onclick = () => {
                if (periodSelect && periodSelect.options.length > 0) {
                    periodSelect.selectedIndex = 0;
                }
                if (projectDescInput) {
                    projectDescInput.value = "";
                }
                if (wbsInput) {
                    wbsInput.value = "";
                }
                if (reasonInput) {
                    reasonInput.value = "";
                }
                persistFormFields();
            };
        }

        if (fillBtn) {
            fillBtn.onclick = async () => {
                const selectedPeriod = periodSelect?.value || "";
                const selectedHistory = history.find((item) => item.period === selectedPeriod);
                const overtimeMap = selectedHistory?.overtimeMap || {};
                const projectDesc = projectDescInput?.value || "";
                const wbs = wbsInput?.value || "";
                const reason = reasonInput?.value || "";

                const overtimeEntries = Object.entries(overtimeMap)
                    .map(([dayKey, overtime]) => [dayKey, Number(overtime)] )
                    .filter(([, overtime]) => Number.isFinite(overtime) && overtime > 0)
                    .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));

                if (!selectedPeriod || overtimeEntries.length === 0) {
                    setRunningNotice("No overtime data for selected period.", "error", 2200);
                    return;
                }

                const tab1Link = document.querySelector('#onetIDListForm a[href="#Tab1"]');
                if (tab1Link) {
                    tab1Link.click();
                }
                await sleep(500);

                const tab1 = document.querySelector("#Tab1");
                if (!tab1) {
                    setRunningNotice("Tab1 not found.", "error", 2200);
                    return;
                }

                const dateInputs = Array.from(tab1.querySelectorAll('input[id*="Date"]'));
                const hourInputs = Array.from(tab1.querySelectorAll('input[id*="Hour"]'));
                const projectDescAreas = Array.from(tab1.querySelectorAll('textarea[id*="Project_desc"]'));
                const wbsInputs = Array.from(tab1.querySelectorAll('input[id*="WBS"]'));
                const reasonAreas = Array.from(tab1.querySelectorAll('textarea[id*="Reason"]'));

                const maxRows = Math.min(
                    overtimeEntries.length,
                    dateInputs.length,
                    hourInputs.length,
                    projectDescAreas.length,
                    wbsInputs.length,
                    reasonAreas.length,
                );

                for (let i = 0; i < maxRows; i += 1) {
                    const [dayNum, overtime] = overtimeEntries[i];
                    const formattedDate = formatMyOtDate(selectedPeriod, dayNum);
                    setFieldValueWithEvents(dateInputs[i], formattedDate);
                    setFieldValueWithEvents(hourInputs[i], String(overtime));
                    setFieldValueWithEvents(projectDescAreas[i], projectDesc);
                    setFieldValueWithEvents(wbsInputs[i], wbs);
                    setFieldValueWithEvents(reasonAreas[i], reason);
                }

                console.log(`${RUNTIME_PREFIX} Overtime fill completed:`, {
                    period: selectedPeriod,
                    filledRows: maxRows,
                    availableRows: {
                        date: dateInputs.length,
                        hour: hourInputs.length,
                        projectDesc: projectDescAreas.length,
                        wbs: wbsInputs.length,
                        reason: reasonAreas.length,
                    },
                });

                setRunningNotice(`Filled ${maxRows} overtime row(s).`, "success", 2200);
                dialog.close();
            };
        }
    }

    function getOrCreateOvertimeFillDialog() {
        let dialog = document.getElementById("myte-ot-fill-dialog");
        if (!dialog) {
            dialog = document.createElement("dialog");
            dialog.id = "myte-ot-fill-dialog";
            dialog.style =
                "border:3px solid #ff7a00; padding:14px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.3); width:680px; max-width:min(92vw, 680px); font-family:'Segoe UI', sans-serif; font-size:13px; color:#1f1f1f;";
            document.body.appendChild(dialog);
        }

        refreshOvertimeFillDialogFields(dialog);
        return dialog;
    }

    function getOrCreateDialog(dataConf = null) {
        let dialog = document.getElementById("myte-tools-dialog");
        if (dialog) {
            return dialog;
        }

        dialog = document.createElement("dialog");
        dialog.id = "myte-tools-dialog";
        dialog.style =
            "border:3px solid #7500c0; padding:18px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.4); width:400px; max-width:min(90vw, 400px); font-family:sans-serif; font-size:13px; background:white; color:#1f1f1f;";
        dialog.innerHTML = buildDialogContent();
        document.body.appendChild(dialog);

        const startButton = dialog.querySelector("#btn-start-fill");
        const resetButton = dialog.querySelector("#btn-reset-hours");
        const closeButton = dialog.querySelector("#btn-close-dialog");

        if (startButton) {
            startButton.onclick = startProcess;
        }

        if (resetButton) {
            resetButton.onclick = resetHoursProcess;
        }

        if (closeButton) {
            closeButton.onclick = () => dialog.close();
        }

        if (dataConf) {
            dialog.dataset.conf = JSON.stringify(dataConf);
        }

        dialog.onclose = () => dialog.dataset.conf = "";

        return dialog;
    }

    function mountButton(titleElement) {
        const button = document.createElement("button");
        button.id = "myte-tools-btn";
        button.style = "border:none; border-radius:20%; position:absolute; margin-left:150px;";
        button.textContent = "⏰";
        button.onclick = () => {
            const dialog = getOrCreateDialog();
            if (!dialog.open) {
                dialog.showModal();
            }
        };

        titleElement.after(button);
    }

    function mountOvertimeFillButton() {
        // const tab1 = document.querySelector("#Tab1");
        // const totalHours = tab1?.querySelector("#TotalHours");
        // const dialogTitleSpan = document.querySelector('#dialogTitleSpan');
        // const dialogContainer = document.querySelector('#HillbillyTabify');
        const form = document.querySelector('form[action*=myOT]');
        const dialogContainer = form?.parentElement;
        const existingButton = document.getElementById("myot-fill-btn");

        if (!dialogContainer) {
            if (existingButton) {
                existingButton.remove();
            }
            return;
        }

        if (existingButton) {
            return;
        }

        const button = document.createElement("button");
        button.id = "myot-fill-btn";
        button.style = "border:none; border-radius:10%; min-width:30px; padding:3px; font-size:16px; cursor:pointer; position:absolute; z-index: 5000; left: 260px; top: 12px;";
        button.textContent = "📝";
        button.onclick = () => {
            const dialog = getOrCreateOvertimeFillDialog();
            if (!dialog.open) {
                dialog.showModal();
            }
        };

        dialogContainer.append(button);
    }

    async function mountToolbarButton(targetElement) {
        if (!targetElement) {
            return;
        }

        const btnDiv = document.createElement("div");
        btnDiv.id = "myte-toolbar-buttons";
        btnDiv.style = "display:flex; align-items:center; gap:6px; margin-left:6px;";
        btnDiv.innerHTML = `
            <button id="myte-toolbar-workhours-btn" style="border:none; border-radius:20%; cursor:pointer; font-size:18px; padding:4px; line-height:1;">⏰</button>
            <span style="margin-left: 5px;margin-right: 5px;">|</span>
            <button id="myte-toolbar-email-btn" style="border: none;border-radius: 20%; cursor:pointer; font-size:18px; padding:4px; line-height:1;">📧</button>
        `;

        targetElement.after(btnDiv);

        const toolbarBtn = document.getElementById("myte-toolbar-workhours-btn");
        if (toolbarBtn) {
            toolbarBtn.addEventListener("click", async () => {
                const workHoursHeader = document.querySelector("#working-hours-side-header");
                if (workHoursHeader) {
                    workHoursHeader.click();
                    await sleep(300);
                }

                try {
                    // await waitForSelector(".myte-accordion-title", 10000);
                    await waitForSelector("#myte-tools-btn", 2000);
                    // await sleep(1200);
                } catch (error) {
                    console.warn(`${RUNTIME_PREFIX} Timeout waiting for accordion:`, error);
                }

                await sleep(100);
                const btn = document.getElementById("myte-tools-btn");
                if (btn) {
                    btn.click();
                }
                await sleep(300);
                const dialog = document.getElementById("myte-tools-dialog");
                if (dialog) {
                    dialog.dataset.conf = JSON.stringify({ autoSave: true });
                }
                // const dialog = getOrCreateDialog({ autoSave: true });
                // dialog.innerHTML = buildDialogContent();
                // if (!dialog.open) {
                //     dialog.showModal();
                // }
            });
        }

        const emailBtn = document.getElementById("myte-toolbar-email-btn");
        if (emailBtn) {
            emailBtn.addEventListener("click", () => {
                const dialog = getOrCreateEmailDialog();
                const templateInput = dialog.querySelector("#email-template-input");
                if (templateInput) {
                    templateInput.value = getSavedEmailTemplate();
                }
                if (!dialog.open) {
                    dialog.showModal();
                }
            });
        }
    }

    function handleToolbarUI() {
        const toolBarBtnGrp = document.querySelector('#acn-header-brand-title');
        const existingBtn = document.getElementById("myte-toolbar-buttons");

        if (toolBarBtnGrp && !existingBtn) {
            mountToolbarButton(toolBarBtnGrp);
        }
    }

    function handleUI() {
        handleToolbarUI();
        mountOvertimeFillButton();

        const accordionTitle = document.querySelector(".myte-accordion-title");
        const existingButton = document.getElementById("myte-tools-btn");
        const dialog = document.getElementById("myte-tools-dialog");

        if (!accordionTitle) {
            if (existingButton) {
                existingButton.remove();
            }
            if (dialog?.open) {
                dialog.close();
            }
            return;
        }

        const titleElement = document.querySelector(".popup-container .header .title");
        if (titleElement && !existingButton) {
            mountButton(titleElement);
        }
    }

    // Avoid duplicate intervals when userscript is re-injected.
    if (window.__myteToolsUiIntervalId) {
        clearInterval(window.__myteToolsUiIntervalId);
    }
    window.__myteToolsUiIntervalId = setInterval(handleUI, UI_INTERVAL_MS);
})();
