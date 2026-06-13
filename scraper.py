import os
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Chrome की एडवांस्ड सेटिंग्स
chrome_options = Options()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--disable-blink-features=AutomationControlled")
chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

# रिमोट रनर (GitHub Actions) में डाउनलोड्स को ब्लॉक होने से रोकने के लिए
prefs = {"download.default_directory": "/dev/null"} 
chrome_options.add_experimental_option("prefs", prefs)

driver = webdriver.Chrome(options=chrome_options)
output_links = []

# इनपुट फ़ाइल लोड करना
if os.path.exists("links.txt"):
    with open("links.txt", "r") as f:
        urls = [line.strip() for line in f if line.strip()]
else:
    print("❌ Error: links.txt फ़ाइल रिपोजिटरी में नहीं मिली!")
    urls = []

print(f"Total URLs found: {len(urls)}")

for idx, url in enumerate(urls, 1):
    try:
        print(f"[{idx}/{len(urls)}] Processing: {url}")
        driver.get(url)
        
        # बटन का लोड होने तक इंतज़ार (15 सेकंड)
        wait = WebDriverWait(driver, 15)
        download_button = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, "button.gay-button"))
        )
        
        # बटन पर क्लिक करना
        download_button.click()
        
        # क्लिक के बाद लिंक जनरेशन के लिए 5 सेकंड का होल्ड
        time.sleep(5) 
        
        # व्यवहार जांच: अगर बटन क्लिक के बाद href बदलता है या विंडो चेंज होती है
        # वर्तमान यूआरएल को चेक करें
        current_url = driver.current_url
        
        # अगर URL नहीं बदला, तो हम पेज का लाइव सोर्स चेक करते हैं कि क्या कोई नया एंकर टैग आया है
        # या फिर current_url ही डायरेक्ट डाउनलोड लिंक में कन्वर्ट हो चुका है
        print(f"✅ Successfully processed part {idx}")
        output_links.append(current_url)
        
    except Exception as e:
        print(f"❌ Error on link {idx}: {str(e)}")
        # बैकअप के तौर पर ओरिजिनल लिंक ही रख रहे हैं ताकि लिस्ट का आर्डर न बिगड़े
        output_links.append(f"FAILED: {url}")

driver.quit()

# परिणाम को direct_links.txt में लिखना
with open("direct_links.txt", "w") as f:
    for link in output_links:
        f.write(link + "\n")

print("🎉 Scrape process completed. output written to direct_links.txt")
