import os
import re
import time
import requests

# HTTP Requests के लिए Headers (ताकि साइट ब्लॉक न करे)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5"
}

output_links = []

# इनपुट फ़ाइल लोड करना
if os.path.exists("links.txt"):
    with open("links.txt", "r") as f:
        urls = [line.strip() for line in f if line.strip()]
else:
    print("❌ Error: links.txt फ़ाइल रिपोजिटरी में नहीं मिली!")
    urls = []

print(f"Total URLs found: {len(urls)}")

# Requests Session का उपयोग करने से Connection Reuse होता है और स्पीड बढ़ती है
session = requests.Session()
session.headers.update(HEADERS)

for idx, url in enumerate(urls, 1):
    try:
        start_time = time.time()
        print(f"[{idx}/{len(urls)}] Processing: {url}")
        
        # सीधे पेज का HTML सोर्स कोड डाउनलोड करें (बिना किसी ब्राउज़र के)
        response = session.get(url, timeout=10)
        
        if response.status_code == 200:
            page_source = response.text
            
            # Regex पैटर्न: window.open("https://dl.fuckingfast.co/dl/...") को ढूंढने के लिए
            match = re.search(r'window\.open\("(https://dl\.fuckingfast\.co/dl/[^"]+)"\)', page_source)
            
            if match:
                direct_link = match.group(1)
                elapsed_time = time.time() - start_time
                # 🛠️ सुधार: यहां :.2s की जगह :.2f का उपयोग किया गया है
                print(f"✅ Extracted in {elapsed_time:.2f}s -> Found: {direct_link}")
                output_links.append(direct_link)
            else:
                # यदि विशेष स्क्रिप्ट पैटर्न नहीं मिलता, तो बैकअप के रूप में सामान्य href सर्च करें
                backup_match = re.search(r'(https://dl\.fuckingfast\.co/dl/[^\s"\']+)', page_source)
                if backup_match:
                    direct_link = backup_match.group(1)
                    print(f"✅ Found via backup regex -> {direct_link}")
                    output_links.append(direct_link)
                else:
                    print(f"⚠️ Direct link script not found in HTML. Using original URL as fallback.")
                    output_links.append(url)
        else:
            print(f"❌ HTTP Error {response.status_code} on link {idx}")
            output_links.append(f"FAILED: {url}")
            
    except Exception as e:
        print(f"❌ Error on link {idx}: {str(e)}")
        output_links.append(f"FAILED: {url}")

# परिणाम को direct_links.txt में लिखना
with open("direct_links.txt", "w") as f:
    for link in output_links:
        f.write(link + "\n")

print("🎉 Scrape process completed. Output written to direct_links.txt")
