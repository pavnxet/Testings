// ==UserScript==
// @name         pCloud Draggable & Minimizable Bulk Dashboard
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Adds a beautiful, draggable, and minimizable dashboard to pCloud for seamless bulk uploading
// @author       YourName
// @match        https://my.pcloud.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // सटीक सिलेक्टर्स 🔍
    const SELECTORS = {
        mainAddBtn: 'button.UploadButton__Button-sc-nky7rg-2.iuPMKh',
        menuItemText: 'File from URL',
        urlInput: 'input[placeholder="Paste file URL here"]',
        finalUploadBtn: 'button[data-testid="tid-6ced7a35"]',
        cancelButton: 'button.ModalCancelButton'
    };

    // हेल्पर फंक्शन: एलिमेंट लोड होने का इंतज़ार करना ⏳
    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    observer.disconnect();
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element not found: ${selector}`));
            }, timeout);
        });
    }

    // हेल्पर फंक्शन: मोडल बंद होने तक लूप को रोकना 🛑
    function waitForModalToClose(selector, timeout = 6000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const check = setInterval(() => {
                const el = document.querySelector(selector);
                if (!el || (Date.now() - startTime) > timeout) {
                    clearInterval(check);
                    resolve();
                }
            }, 200);
        });
    }

    // मुख्य ऑटोमेशन लॉजिक 🚀
    async function startBulkUpload(urlList, statusDiv, startBtn) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

        for (const [index, url] of urlList.entries()) {
            const cleanUrl = url.trim();
            if (!cleanUrl) continue;

            statusDiv.innerText = `⏳ Processing (${index + 1}/${urlList.length})...`;
            statusDiv.style.color = '#333';

            try {
                // Step 1: "Add" बटन क्लिक करें
                const addButton = await waitForElement(SELECTORS.mainAddBtn);
                addButton.click();
                await new Promise(r => setTimeout(r, 800));

                // Step 2: "File from URL" चुनें
                const menuItems = Array.from(document.querySelectorAll('div, span, button'));
                const urlOption = menuItems.find(el => el.innerText.trim() === SELECTORS.menuItemText);

                if (!urlOption) throw new Error("'File from URL' option missing");
                urlOption.click();
                await new Promise(r => setTimeout(r, 1000));

                // Step 3: इनपुट बॉक्स में लिंक डालें
                const inputField = await waitForElement(SELECTORS.urlInput);
                if (inputField) {
                    nativeInputValueSetter.call(inputField, cleanUrl);
                    inputField.dispatchEvent(new Event('input', { bubbles: true }));
                    inputField.dispatchEvent(new Event('change', { bubbles: true }));
                }
                await new Promise(r => setTimeout(r, 600));

                // Step 4: फ़ाइनल "Upload" बटन दबाएं 🎯
                const finalUploadBtn = await waitForElement(SELECTORS.finalUploadBtn);

                if (finalUploadBtn && finalUploadBtn.offsetParent !== null) {
                    finalUploadBtn.click();

                    finalUploadBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    finalUploadBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    finalUploadBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                    const spanLabel = finalUploadBtn.querySelector('.btn-label');
                    if (spanLabel) spanLabel.click();

                    // मोडल के बंद होने का इंतज़ार करें
                    statusDiv.innerText = `⏳ Waiting for Upload confirmation (${index + 1}/${urlList.length})...`;
                    await waitForModalToClose(SELECTORS.urlInput);

                    await new Promise(r => setTimeout(r, 1500));
                } else {
                    throw new Error("Final Upload button not interactive");
                }

            } catch (error) {
                console.error(`❌ Error at index ${index}:`, error.message);
                statusDiv.innerText = `⚠️ Skipped item ${index + 1} due to error.`;
                statusDiv.style.color = '#ff4d4d';

                const cancelBtn = document.querySelector(SELECTORS.cancelButton);
                if (cancelBtn) cancelBtn.click();
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        statusDiv.innerText = "🎉 All URLs Processed!";
        statusDiv.style.color = "#4CAF50";
        startBtn.disabled = false;
        startBtn.style.backgroundColor = '#007bff';
        startBtn.innerText = '▶️ Start Bulk Upload';
    }

    // ड्रेगेबल और मिनीमाइज़ेबल UI डैशबोर्ड बनाना 🔘
    function createBulkDashboard() {
        if (document.getElementById('tm-bulk-dashboard')) return;

        // मुख्य कंटेनर (विजेट)
        const dashboard = document.createElement('div');
        dashboard.id = 'tm-bulk-dashboard';
        dashboard.style.position = 'fixed';
        dashboard.style.bottom = '30px';
        dashboard.style.right = '30px';
        dashboard.style.zIndex = '999999';
        dashboard.style.backgroundColor = '#fff';
        dashboard.style.border = '2px solid #007bff';
        dashboard.style.borderRadius = '10px';
        dashboard.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
        dashboard.style.width = '320px';
        dashboard.style.fontFamily = 'Arial, sans-serif';
        dashboard.style.overflow = 'hidden';

        // हेडर बार (यह ड्रैग करने के काम आएगा) 🎛️
        const header = document.createElement('div');
        header.style.padding = '10px 15px';
        header.style.backgroundColor = '#007bff';
        header.style.color = '#fff';
        header.style.cursor = 'move';
        header.style.fontWeight = 'bold';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.userSelect = 'none';
        header.innerHTML = '<span>🔗 pCloud Bulk Bulk Uploader</span>';

        // मिनीमाइज़ बटन ➖
        const minBtn = document.createElement('button');
        minBtn.innerText = '➖';
        minBtn.style.background = 'none';
        minBtn.style.border = 'none';
        minBtn.style.color = '#fff';
        minBtn.style.cursor = 'pointer';
        minBtn.style.fontSize = '12px';
        header.appendChild(minBtn);
        dashboard.appendChild(header);

        // बॉडी कंटेनर (जिसमें इनपुट बॉक्स और बटन हैं)
        const bodyContainer = document.createElement('div');
        bodyContainer.style.padding = '15px';

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'अपनी बल्क लिंक्स यहाँ पेस्ट करें...\n(एक लाइन में केवल एक लिंक)';
        textarea.style.width = '100%';
        textarea.style.height = '140px';
        textarea.style.boxSizing = 'border-box';
        textarea.style.marginBottom = '10px';
        textarea.style.borderRadius = '5px';
        textarea.style.border = '1px solid #ccc';
        textarea.style.padding = '8px';
        textarea.style.resize = 'vertical';
        bodyContainer.appendChild(textarea);

        const statusDiv = document.createElement('div');
        statusDiv.innerText = 'Status: Ready';
        statusDiv.style.fontSize = '12px';
        statusDiv.style.marginBottom = '10px';
        statusDiv.style.color = '#666';
        bodyContainer.appendChild(statusDiv);

        const startBtn = document.createElement('button');
        startBtn.innerText = '▶️ Start Bulk Upload';
        startBtn.style.width = '100%';
        startBtn.style.padding = '10px';
        startBtn.style.backgroundColor = '#007bff';
        startBtn.style.color = 'white';
        startBtn.style.border = 'none';
        startBtn.style.borderRadius = '5px';
        startBtn.style.cursor = 'pointer';
        startBtn.style.fontWeight = 'bold';

        startBtn.addEventListener('click', () => {
            const rawText = textarea.value;
            const urls = rawText.split('\n').map(u => u.trim()).filter(u => u.length > 0);

            if (urls.length === 0) {
                statusDiv.innerText = '❌ कृपया लिंक्स दर्ज करें!';
                statusDiv.style.color = '#ff4d4d';
                return;
            }

            startBtn.disabled = true;
            startBtn.style.backgroundColor = '#cccccc';
            startBtn.innerText = '⏳ Processing...';

            startBulkUpload(urls, statusDiv, startBtn);
        });

        bodyContainer.appendChild(startBtn);
        dashboard.appendChild(bodyContainer);
        document.body.appendChild(dashboard);

        // --- मिनीमाइज़ / मैक्सिमाइज लॉजिक 📉 ---
        let isMinimized = false;
        minBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // ड्रैग इवेंट को रोकने के लिए
            if (!isMinimized) {
                bodyContainer.style.display = 'none';
                dashboard.style.width = '180px';
                minBtn.innerText = '➕';
                isMinimized = true;
            } else {
                bodyContainer.style.display = 'block';
                dashboard.style.width = '320px';
                minBtn.innerText = '➖';
                isMinimized = false;
            }
        });

        // --- ड्रैग एंड ड्रॉप (Drag & Drop) लॉजिक 🚚 ---
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        header.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            if (e.target === header || header.contains(e.target)) {
                isDragging = true;
            }
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;

                // बॉटम/राइट फिक्स्ड पोजीशन को ट्रांसफॉर्म की मदद से खिसकाना
                dashboard.style.transform = `translate(${currentX}px, ${currentY}px)`;
            }
        }

        function dragEnd() {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }
    }

    setInterval(createBulkDashboard, 2000);
})();
