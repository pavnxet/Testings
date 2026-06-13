import os
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Chrome की एडवांस्ड और फास्ट सेटिंग्स
chrome_options = Options()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--disable-blink-features=AutomationControlled")
chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# ⚡ स्पीड बूस्टर: इमेज, CSS और एक्सटेंशन लोड होने से रोकें ताकि पेज तुरंत लोड हो
prefs = {
    "download.default_directory": "/dev/null",
    "profile.managed_default_content_settings.images": 2,      # 2 का मतलब Images ब्लॉक
    "profile.managed_default_content_settings.stylesheets": 2, # Stylesheets/CSS ब्लॉक
    "profile.managed_default_content_settings.cookies": 1
} 
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
        start_time = time.time()
        print(f"[{idx}/{len(urls)}] Processing: {url}")
        driver.get(url)
        
        # बटन का लोड होने तक इंतज़ार (अधिकतम 10 सेकंड)
        wait = WebDriverWait(driver, 10)
        download_button = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, "button.gay-button"))
        )
        
        # window.open को हुक/ओवरराइड करना ताकि यह तुरंत लिंक कैप्चर करे
        driver.execute_script("""
            window.capturedDownloadUrl = null;
            window.open = function(openUrl) {
                window.capturedDownloadUrl = openUrl;
                return null;
            };
        """)
        
        # बटन पर त्वरित क्लिक
        driver.execute_script("arguments[0].click();", download_button)
        
        # ⚡ डायनामिक वेटिंग (Zero Fixed Sleep): जैसे ही लिंक मिलेगा, लूप तुरंत आगे बढ़ेगा
        direct_link = None
        for _ in range(25):  # अधिकतम 5 सेकंड का इंतज़ार (0.2s * 25)
            direct_link = driver.execute_script("return window.capturedDownloadUrl;")
            if direct_link:
                break
            time.sleep(0.2)
        
        # बैकअप विकल्प: अगर जावास्क्रिप्ट हुक से नहीं मिला, तो तुरंत DOM स्कैन करें
        if not direct_link:
            links_in_page = driver.find_elements(By.TAG_NAME, "a")
            for a_tag in links_in_page:
                href = a_tag.get_attribute("href")
                if href and ("dl.fuckingfast.co/dl/" in href or href.endswith('.rar')):
                    direct_link = href
                    break
                    
        # अंतिम बैकअप
        if not direct_link:
            direct_link = driver.current_url
            
        elapsed_time = time.time() - start_time
        print(f"✅ Successfully processed part {idx} in {elapsed_time:.2s}s -> Found: {direct_link}")
        output_links.append(direct_link)
        
    except Exception as e:
        print(f"❌ Error on link {idx}: {str(e)}")
        output_links.append(f"FAILED: {url}")

driver.quit()

# परिणाम को direct_links.txt में लिखना
with open("direct_links.txt", "w") as f:
    for link in output_links:
        f.write(link + "\n")

print("🎉 Scrape process completed. output written to direct_links.txt")
