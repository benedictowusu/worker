# 🌐 Altified Cloudflare Worker

The Altified Worker is a high-performance edge translation layer. It automatically detects, translates, and injects a language switcher into your website using the Altified API, ensuring a seamless multilingual experience with zero latency impact.

## 🚀 One-Click Deployment

Click the button below to deploy this worker to your own Cloudflare account instantly.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/benedictowusu/worker)
---

## 🛠 Features

* **Full Page Translation:** Translates `<head>` metadata (titles, descriptions, OG tags) and `<body>` content.
* **Dynamic Language Switcher:** Injects a customizable floating language selector.
* **SEO Optimized:** Automatically adds `hreflang` tags and handles language-prefixed URLs (e.g., `/es/about`).
* **Edge Caching:** Uses Cloudflare's global cache to store translations for maximum speed.
* **Zero FOUC:** Built-in logic to prevent "Flash of Untranslated Content."

## 📋 Prerequisites

Before clicking the deploy button, make sure you have:
1.  A **Cloudflare Account**.
2.  An **Altified API Key** (Get yours at [altified.com](https://altified.com)).
3.  The **Domain** name you intend to use (e.g., `example.com`).

## ⚙️ Setup Instructions

1.  **Deploy:** Click the "Deploy to Cloudflare" button above.
2.  **Configure Variables:** During the setup process, Cloudflare will ask you to provide:
    * `ALTIFIED_API_KEY`: Your unique project key from Altified.
    * `DOMAIN`: Your website's root domain.
3.  **Routes:** After deployment, go to your Worker settings in the Cloudflare Dashboard and add a **Route** to map the worker to your site (e.g., `example.com/*`).

## 📄 License
MIT License. Created by Altified.
