import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Inkvoice",
  description: "Lightweight, self-hosted invoicing dashboard",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }]],
  cleanUrls: true,
  ignoreDeadLinks: [/localhost/],

  themeConfig: {
    siteTitle: "Inkvoice",
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Features", link: "/features/" },
      { text: "API", link: "/api/" },
      {
        text: "GitHub",
        link: "https://github.com/pigontech/inkvoice",
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/guide/" },
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Configuration", link: "/guide/configuration" },
          { text: "Deployment", link: "/guide/deployment" },
        ],
      },
      {
        text: "Features",
        items: [
          { text: "Overview", link: "/features/" },
          { text: "Invoices", link: "/features/invoices" },
          { text: "Quotes", link: "/features/quotes" },
          { text: "Customers", link: "/features/customers" },
          { text: "Products", link: "/features/products" },
          { text: "Recurring Invoices", link: "/features/recurring" },
          { text: "Templates", link: "/features/templates" },
          { text: "Reports", link: "/features/reports" },
          { text: "Accounting Export", link: "/features/accounting-export" },
          { text: "Online Payments", link: "/features/payments" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "Overview", link: "/api/" },
          { text: "Authentication", link: "/api/authentication" },
          { text: "Invoices", link: "/api/invoices" },
          { text: "Quotes", link: "/api/quotes" },
          { text: "Customers", link: "/api/customers" },
          { text: "Products", link: "/api/products" },
          { text: "Templates", link: "/api/templates" },
          { text: "Settings", link: "/api/settings" },
          { text: "Reports", link: "/api/reports" },
          { text: "Integrations", link: "/api/integrations" },
        ],
      },
      {
        text: "Development",
        items: [{ text: "Contributing", link: "/development/" }],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/pigontech/inkvoice" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright &copy; 2026 Inkvoice",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern:
        "https://github.com/pigontech/inkvoice/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
