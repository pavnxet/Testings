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
        
        # ओरिजिनल विंडो का हैंडल सेव करें
        original_window = driver.current_window_handle
        
        # बटन पर क्लिक करना
        download_button.click()
        
        # लिंक जनरेशन और नए टैब/DOM अपडेट के लिए इंतज़ार
        time.sleep(6) 
        
        direct_link = None

        # स्थिति 1: चेक करें कि क्या कोई नया टैब या पॉपअप खुला है
        if len(driver.window_handles) > 1:
            for handle in driver.window_handles:
                if handle != original_window:
                    driver.switch_to.window(handle)
                    direct_link = driver.current_url
                    driver.close() # नया टैब बंद करें
                    driver.switch_to.window(original_window)
                    break

        # स्थिति 2: अगर नया टैब नहीं खुला, तो DOM में जनरेट हुए डायरेक्ट डाउनलोड लिंक को ढूंढें
        if not direct_link:
            # FuckingFast आमतौर पर क्लिक के बाद एक नया एंकर लिंक दिखाता है जिसमें फ़ाइल का नाम या डाउनलोड पाथ होता है
            # हम ऐसे एंकर टैग्स ढूंढ रहे हैं जिनमें href मौजूद हो और वह ओरिजिनल URL न हो
            links_in_page = driver.find_elements(By.TAG_CODES if hasattr(By, 'TAG_CODES') else By.TAG_NAME, "a")
            for a_tag in links_in_page:
                href = a_tag.get_attribute("href")
                if href and ("fuckingfast.co/files/" in href or "download" in href.lower() or href.endswith('.rar')):
                    direct_link = href
                    break
            
            # अगर विशेष पैटर्न नहीं मिला, तो अंतिम प्रयास के रूप में क्लास या आईडी के आधार पर ढूंढें
            if not direct_link:
                try:
                    # आप पेज सोर्स देखकर इस स्पेसिफिक सेलेक्टर को बाद में बदल भी सकते हैं
                    final_download_element = driver.find_element(By.CSS_SELECTOR, "a.download-link, div.download-zone a")
                    direct_link = final_download_element.get_attribute("href")
                except:
                    pass

        # स्थिति 3: अगर कुछ भी नहीं बदला, तो वर्तमान URL को ही बैकअप लें
        if not direct_link:
            direct_link = driver.current_url

        print(f"✅ Successfully processed part {idx} -> Found Link: {direct_link}")
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
