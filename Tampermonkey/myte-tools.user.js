// ==UserScript==
// @name         myTE Tools
// @namespace    https://github.com/jerrywdlee/myTE-Tools
// @version      1.0.3
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
    const NOTICE_ID = "helper-running-notice";
    const NOTICE_ANIMATION_MS = 1000;
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
    ]

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
        setRunningNotice("myTE Auto-Filler is running...", "running", 2000);
        await sleep(50);
        logStatus("Starting auto fill...",);

        try {
            const syncOt = document.getElementById("sync-ot")?.checked;
            const skipVacations = document.getElementById("skip-vacations")?.checked;
            const overtimeMap = syncOt ? getOvertimeMap() : {};
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
        setRunningNotice("myTE hour entries are being reset...", "running", 2000);
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
                <button id="btn-start-fill" style="width:100%; background:#7500c0; color:white; border:none; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">START FILLING</button>
                <button id="btn-reset-hours" style="width:100%; background:white; color:#7500c0; border:1px solid #7500c0; padding:12px; cursor:pointer; border-radius:6px; font-weight:bold;">RESET HOURS</button>
            </div>
        `;
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

    async function mountToolbarButton() {
        const toolBarBtnGrp = document.querySelector('[role=toolbar] .btn-group');
        if (!toolBarBtnGrp) {
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

        toolBarBtnGrp.after(btnDiv);

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
                    await waitForSelector("#myte-tools-btn", 10000);
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
    }

    function handleToolbarUI() {
        const toolBarBtnGrp = document.querySelector('[role=toolbar] .btn-group');
        const existingBtn = document.getElementById("myte-toolbar-buttons");

        if (toolBarBtnGrp && !existingBtn) {
            mountToolbarButton();
        }
    }

    function handleUI() {
        handleToolbarUI();

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
