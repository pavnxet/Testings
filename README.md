# ⚡ FitGirl Link Streamliner (FuckingFast Link Extractor)

An intelligent, secure, and ultra-fast automation utility designed to instantly resolve and extract direct download links from FuckingFast.co hosting pages for FitGirl repacks. 

This repository features both a high-performance Python script for local automation and an edge-optimized Cloudflare Worker for a beautiful, independent web-based panel.

---

## 🚀 Key Features

* **10x Faster Parsing:** Replaced heavy Selenium headless browser layers with synchronous atomic HTTP request streaming and precise Regular Expressions. Runs in milliseconds instead of minutes.
* **Edge-Native Architecture:** Includes a single-file Cloudflare Worker (`worker.js`) to host an independent Web UI Panel that processes batch links on the fly without server overhead.
* **Rate-Limit Guard:** Hardened server security that strictly limits batch execution to 30 URLs per request to prevent server strain or Edge infrastructure abuse.
* **Protocol & Domain Hardening:** Built-in validation rules that strictly enforce secure `https://` checking and reject unauthorized third-party tracking domains or suspicious scripts.
* **Security Headers Enabled:** The Web Interface natively injects protective headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `X-XSS-Protection`) to mitigate Clickjacking and Cross-Site Scripting vulnerabilities.
* **Creamy Design System:** Features a bespoke, highly comfortable Microsoft Copilot-inspired "Warm Sand & Cream Light" user interface crafted to eliminate screen glare and maximize contrast safety.

---

## 🛠️ Architecture & Core Components

### 1. The Cloudflare Edge Environment (`worker.js`)
An independent, standalone serverless dashboard running entirely on Cloudflare's Edge network. It provides an elegant input terminal where you can drop a batch of text links, extracts the direct file payloads safely, and displays cleanly separated output logs.

### 2. Local/Runner Automation Engine (`scraper.py`)
An optimized local execution tool ideal for programmatic task managers or remote CI environments (like GitHub Actions runners). It maps raw file hosting keys directly into explicit payload vectors instantly.

---

## 💻 Local Quick Start

### Installation
Ensure you have Python 3.10+ installed on your local environment, then initialize dependencies using the module manager switch:

```bash
python -m pip install --upgrade pip
pip install requests
