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
chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

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
        
        # 🛠️ जादुई स्क्रिप्ट: window.open को हुक/ओवरराइड करना ताकि यह नया टैब खोलने के बजाय लिंक कैप्चर कर ले
        driver.execute_script("""
            window.capturedDownloadUrl = null;
            window.open = function(openUrl) {
                window.capturedDownloadUrl = openUrl;
                return null;
            };
        """)
        
        # बटन पर क्लिक करना (जावास्क्रिप्ट के ज़रिए क्लिक ताकि पॉपअप ब्लॉकर ट्रिगर न हो)
        driver.execute_script("arguments[0].click();", download_button)
        
        # लिंक जनरेशन और वेरिएबल अपडेट के लिए थोड़ा इंतज़ार (5 सेकंड)
        time.sleep(5) 
        
        # इंजेक्ट किए गए वेरिएबल से डायरेक्ट लिंक प्राप्त करना
        direct_link = driver.execute_script("return window.capturedDownloadUrl;")
        
        # बैकअप विकल्प: अगर जावास्क्रिप्ट हुक काम न करे, तो पारंपरिक एंकर टैग्स स्कैन करें
        if not direct_link:
            links_in_page = driver.find_elements(By.TAG_NAME, "a")
            for a_tag in links_in_page:
                href = a_tag.get_attribute("href")
                if href and ("dl.fuckingfast.co/dl/" in href or href.endswith('.rar')):
                    direct_link = href
                    break
                    
        # अंतिम बैकअप विकल्प: अगर कुछ भी न मिले तो ओरिजिनल यूआरएल का उपयोग करें
        if not direct_link:
            direct_link = driver.current_url
            
        print(f"✅ Successfully processed part {idx} -> Found: {direct_link}")
        output_links.append(direct_link)
        
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
