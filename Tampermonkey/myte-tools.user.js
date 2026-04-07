// ==UserScript==
// @name         myTE Tools
// @namespace    https://github.com/jerrywdlee/myTE-Tools
// @version      1.0.0
// @description  Auto-fill myTE working hours with optional overtime synchronization.
// @author       jerrywdlee
// @match        https://myte.accenture.com/*
// @homepageURL  https://github.com/jerrywdlee/myTE-Tools
// @supportURL   https://github.com/jerrywdlee/myTE-Tools/issues
// @downloadURL  https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
// @updateURL    https://raw.githubusercontent.com/jerrywdlee/myTE-Tools/main/Tampermonkey/myte-tools.user.js
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const UI_INTERVAL_MS = 1000;
    const WORKING_GRID_SELECTOR = "#workingHoursPunchClockGrid .ag-row";
    const RUNTIME_PREFIX = "[myTE Tools]";

    const state = {
        panelDismissed: false,
    };

    function logStatus(message) {
        console.log(`${RUNTIME_PREFIX} ${message}`);
        const status = document.getElementById("helper-status");
        if (status) {
            status.innerText = message;
        }
    }

    function setRunningNotice(message, variant = "running", autoHideMs = 0) {
        let notice = document.getElementById("helper-running-notice");

        if (!message) {
            if (notice) {
                notice.remove();
            }
            return;
        }

        if (!notice) {
            notice = document.createElement("div");
            notice.id = "helper-running-notice";
            document.body.appendChild(notice);
        }

        const palette = {
            running: { bg: "#1f1f1f", fg: "#ffffff" },
            success: { bg: "#1f7a3d", fg: "#ffffff" },
            error: { bg: "#9b1c1c", fg: "#ffffff" },
        };
        const colors = palette[variant] || palette.running;

        notice.style = `position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:1000000; background:${colors.bg}; color:${colors.fg}; padding:14px 18px; border-radius:10px; font-family:sans-serif; font-size:14px; font-weight:bold; box-shadow:0 12px 28px rgba(0,0,0,0.35); min-width:220px; text-align:center;`;
        notice.innerHTML = `<div id="helper-status">${message}</div>`;

        if (notice._hideTimer) {
            clearTimeout(notice._hideTimer);
            notice._hideTimer = null;
        }

        if (autoHideMs > 0) {
            notice._hideTimer = setTimeout(() => notice.remove(), autoHideMs);
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

    async function startProcess() {
        setRunningNotice("myTE Auto-Filler is running...", "running");
        logStatus("Starting auto fill...");

        try {
            const syncOt = document.getElementById("sync-ot")?.checked;
            const overtimeMap = syncOt ? getOvertimeMap() : {};

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
        } catch (error) {
            console.error(`${RUNTIME_PREFIX} Auto fill failed:`, error);
            logStatus("Failed. Check console.");
            setRunningNotice("Failed. Check console.", "error", 2500);
        }
    }

    function buildPanelHtml() {
        return `
            <button id="btn-close-helper" style="position:absolute; top:8px; right:8px; width:24px; height:24px; border:none; background:transparent; color:#7500c0; font-size:18px; cursor:pointer; line-height:1;" title="Close">&times;</button>
            <div style="font-weight:bold; color:#7500c0; margin-bottom:15px; font-size:15px; text-align:center; border-bottom:1px solid #eee; padding-bottom:8px;">myTE Auto-Filler</div>
            <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between;"><span>Work:</span><span><input type="text" id="in-ws" value="9" style="width:35px; text-align:center;"> - <input type="text" id="in-we" value="12" style="width:35px; text-align:center;"></span></div>
                <div style="display:flex; align-items:center; justify-content:space-between;"><span>Break:</span><span><input type="text" id="in-bs" value="12" style="width:35px; text-align:center;"> - <input type="text" id="in-be" value="13" style="width:35px; text-align:center;"></span></div>
                <div style="display:flex; align-items:center; justify-content:space-between;"><span>Work:</span><span><input type="text" id="in-r2s" value="13" style="width:35px; text-align:center;"> - <input type="text" id="in-r2e" value="18" style="width:35px; text-align:center;"></span></div>
            </div>
            <div style="margin-bottom:10px; padding:8px; background:#f4f0ff; border-radius:6px;">
                <label style="cursor:pointer; display:flex; align-items:center; gap:8px;"><input type="checkbox" id="sync-ot" checked><span style="font-weight:bold; color:#7500c0;">Auto-sync Overtime</span></label>
            </div>
            <button id="btn-start-fill" style="width:100%; background:#7500c0; color:white; border:none; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">START FILLING</button>
        `;
    }

    function mountPanel() {
        const panel = document.createElement("div");
        panel.id = "ballban-helper";
        panel.style =
            "position:fixed; top:100px; right:30px; z-index:999999; background:white; border:3px solid #7500c0; padding:15px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.4); width:200px; font-family:sans-serif; font-size:13px;";
        panel.innerHTML = buildPanelHtml();
        document.body.appendChild(panel);

        const startButton = document.getElementById("btn-start-fill");
        const closeButton = document.getElementById("btn-close-helper");

        if (startButton) {
            startButton.onclick = startProcess;
        }

        if (closeButton) {
            closeButton.onclick = () => {
                state.panelDismissed = true;
                panel.remove();
            };
        }
    }

    function handleUI() {
        const infoPanel = document.querySelector(".myte-accordion-title");
        const existingPanel = document.getElementById("ballban-helper");

        if (!infoPanel) {
            if (existingPanel) {
                existingPanel.remove();
            }
            state.panelDismissed = false;
            return;
        }

        const isInformationPage = infoPanel.innerText.includes("Information");
        if (isInformationPage && !existingPanel && !state.panelDismissed) {
            mountPanel();
        }
    }

    // Avoid duplicate intervals when userscript is re-injected.
    if (window.__myteToolsUiIntervalId) {
        clearInterval(window.__myteToolsUiIntervalId);
    }
    window.__myteToolsUiIntervalId = setInterval(handleUI, UI_INTERVAL_MS);
})();
