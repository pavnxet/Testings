# 🎛️ pCloud Bulk Injector — एक्सटेंशन हब (Hindi & English Master README)

एक सुरक्षित, क्लाइंट-साइड ब्राउज़र ऑटोमेशन मॉड्यूल जिसे आपके pCloud वर्कस्पेस पर एक ड्रेगेबल (Draggable) और मिनीमाइज़ेबल (Minimizable) इंजेक्ट पैनल जोड़ने के लिए डिज़ाइन किया गया है। यह रिएक्ट/व्यू जैसे रिएक्टिव फॉर्म कंट्रोल्स को ऑटोमेट करके आपके एक्सट्रैक्ट किए गए डायरेक्ट डाउनलोड लिंक्स को सीधे रिमोट स्टोरेज स्लॉट में स्ट्रीम करता है।

---

## 📁 रिपोजिटरी फोल्डर पाथ (Repository Folder Location)

इस फ़ाइल को अपनी रिपोजिटरी संरचना में निम्नलिखित स्थान पर रखें:
```text
├── extensions/
│   ├── README.md           # यूज़रस्क्रिप्ट एक्सटेंशन के लिए विशिष्ट डॉक्यूमेंटेशन (यह फ़ाइल)
│   └── pcloud-bulk-injector.user.js  # ड्रेगेबल फ्रंटएंड ऑटोमेशन डैशबोर्ड स्क्रिप्ट

```

---

## 🚀 मुख्य वास्तुकला क्षमताएं (Architectural Capabilities)

* **रिएक्टिव फॉर्म इंटरसेप्शन:** रिएक्टिव स्टेट ट्रैकर्स (React/Vue) को प्रोग्रामेटिक रूप से बायपास करने के लिए मूल जावास्क्रिप्ट ऑब्जेक्ट प्रोटोटाइप डिस्क्रिप्टर एडजस्टमेंट्स का उपयोग करता है, जिससे फ़ील्ड्स इनपुट किए गए लिंक्स को सही ढंग से कैप्चर कर पाते हैं।
* **ड्रेगेबल कोर कैनवास:** फ्लोटिंग रिलेटिव बाउंडिंग एंकर के साथ निर्मित, जो आपको पूरे व्यूपोर्ट में कहीं भी इनपुट टर्मिनल को स्वतंत्र रूप से स्थानांतरित या मिनीमाइज़ करने की अनुमति देता है।
* **अतुल्यकालिक कतार प्रबंधन (Async Queue):** टोकन लोडिंग अंतराल और देरी को क्लीनली संभालने के लिए सुरक्षात्मक संरचनात्मक लूप्स को शामिल करते हुए, मल्टी-लाइन बैच लिंक एरेज़ को क्रमिक रूप से प्रोसेस करता है।
* **सैंडबॉक्स सुरक्षा सुदृढ़ीकरण:** सख्त, नॉन-innerHTML DOM इंस्टाशिएशन नियमों (`document.createElement`) के साथ निर्मित ताकि कठोर एक्सटेंशन सुरक्षा प्रोफाइल का अनुपालन किया जा सके और क्रॉस-साइट एक्ज़ीक्यूशन हुक्स को रोका जा सके।

---

## ⚙️ इंस्टालेशन और डिप्लॉयमेंट (Installation & Deployment)

1. अपने पसंदीदा आधुनिक ब्राउज़र पर **Tampermonkey** या **Violentmonkey** एक्सटेंशन कंटेनर इंस्टॉल करें।
2. एक्सटेंशन डैशबोर्ड के भीतर **Create a new script** पर क्लिक करें।
3. संपूर्ण बॉयलरप्लेट कोड को हटाकर हमारी सुरक्षित एंट्री फ़ाइल `pcloud-bulk-injector.user.js` के कोड से बदलें।
4. कॉन्फ़िगरेशन को सहेजें और अपने pCloud वर्कस्पेस `https://my.pcloud.com/*` पर जाएं।
5. एक प्रीमियम मिनिमल पैनल नीचे दाईं ओर आसानी से फ्लोट करेगा। अपने एक्सट्रैक्ट किए गए बैच लिंक्स पेस्ट करें और **Start Bulk Upload** पर क्लिक करें।

---

## 🛠️ कोड प्रवर्तन दिशानिर्देश (Code Enforcement Guidelines)

* **सिलेक्टर्स विश्वसनीयता:** यदि pCloud भविष्य में अपनी लेआउट संरचना को बदलता है, तो फ़ाइल के शीर्ष पर स्थित स्टेटिक `SELECTORS` ऑब्जेक्ट ब्लॉक के भीतर मानों को सत्यापित और समायोजित करें।
* **कन्फर्मेशन सेफ्टी लूप्स:** अंतर्निहित मोडल विज़िबिलिटी चेकर्स लगातार टारगेट रैपर क्लास की निगरानी करते हैं जब तक कि तत्व गायब न हो जाएं, जिससे कतार ड्रॉपिंग (Queue dropping) की त्रुटियां समाप्त हो जाती हैं।

---

## 💖 आभार और पावती (Credits & Acknowledgments)

हाई-स्पीड क्लाउड ऑपरेशन्स को ऑटोमेट करने पर केंद्रित लिंक स्ट्रीमलाइनर मैट्रिक्स का एक हिस्सा।

* **एक्सटेंशन इंजीनियरिंग:** **pavnxet** द्वारा विकसित
* **आधिकारिक गेटवे पोर्टल:** [pavnxet.github.io](https://pavnxet.github.io/)

---

*अस्वीकरण (Disclaimer): यह टूलकिट विशेष रूप से नियंत्रित क्लाउड ऑप्टिमाइज़ेशन प्रोफाइल के तहत प्रशासनिक डेटा सिंक्रोनाइजेशन टेस्टिंग प्रक्रियाओं के लिए डिज़ाइन किया गया है।*





# 🎛️ pCloud Bulk Injector — Extension Hub (English Version)

A secure, client-side browser automation module designed to attach a draggable and minimizable injection interface onto your pCloud workspace. It automates reactive form controls to stream direct download keys seamlessly into remote storage slots.

---

## 📁 Repository Folder Location

Place this file in the following path inside your repository structure:

```text
├── extensions/
│   ├── README.md           # This specific UserScript documentation (This file)
│   └── pcloud-bulk-injector.user.js  # Draggable frontend automation dashboard

```

---

## 🚀 Architectural Capabilities

* **Reactive Form Interception:** Utilizes native JavaScript object prototype descriptor adjustments to programmatically bypass tightly bound state trackers (React/Vue), forcing fields to capture inputs correctly.
* **Draggable Core Canvas:** Built with floating relative bounding anchors, allowing you to reposition or minimize the input terminal freely anywhere across the viewport.
* **Asynchronous Queue Management:** Processes multi-line batch link arrays sequentially, incorporating protective structural loops to cleanly handle delays and token loading intervals.
* **Sandboxed Security Hardening:** Built with strict, non-innerHTML DOM instantiation rules (`document.createElement`) to comply with rigid extension security profiles and prevent cross-site execution hooks.

---

## ⚙️ Installation & Deployment

1. Install the **Tampermonkey** or **Violentmonkey** extension container on your preferred modern browser.
2. Click **Create a new script** within the extension dashboard.
3. Replace the entire boilerplate container code with the contents of our secure entry file: `pcloud-bulk-injector.user.js`.
4. Save the configuration and head over to your workspace at `https://my.pcloud.com/*`.
5. The minimal panel will float smoothly at the bottom right. Paste your extracted batch links and click **Start Bulk Upload**.

---

## 🛠️ Code Enforcement Guidelines

* **Selector Reliability:** If pCloud mutates its layout structure, verify and adjust the values inside the static `SELECTORS` object block at the head of the file.
* **Confirmation Safety Loops:** Built-in modal visibility checkers continuously monitor the target wrapper class until elements disappear before triggering subsequent iterations, eliminating queue dropping errors.

---

## 💖 Credits & Acknowledgments

Part of the link streamliner matrix focused on automating high-speed cloud operations.

* **Extension Engineering:** Developed by **pavnxet**
* **Official Gateway Portal:** [pavnxet.github.io](https://pavnxet.github.io/)

---

*Disclaimer: This toolkit is explicitly designed for administrative data synchronization testing procedures under controlled cloud optimization profiles.*

