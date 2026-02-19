# OutreachPro — Email Outreach Automation

A browser-based email outreach tool with an **approval queue** (nothing sends without your review), follow-up scheduling, and Google Sheets / Excel tracking.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

#### Gmail (recommended)
1. Enable **2-Step Verification** on your Google account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Create an App Password for "Mail"
4. Set `EMAIL_USER` and `EMAIL_APP_PASSWORD` in `.env`

#### Google Sheets (optional)
1. Create a project at [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Google Sheets API**
3. Create a **Service Account** → download JSON key
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env`
5. Create a Google Sheet, add a tab named `Outreach Tracker`, share it with the service account email
6. Set `GOOGLE_SHEET_ID` (from the sheet URL) in `.env`

### 3. Start the server
```bash
npm start
# or: npm run dev   (auto-restarts on file changes)
```

### 4. Open in browser
```
http://localhost:3000
```

---

## Features

| Feature | Details |
|---|---|
| **Review Queue** | Every email is drafted first — you read and edit before approving to send |
| **Email Templates** | Handlebars variables: `{{name}}`, `{{firstName}}`, `{{company}}`, `{{email}}`, `{{today}}` |
| **Bulk Compose** | Select multiple clients, pick a template, queue all at once |
| **CSV Import** | Import clients from a CSV file (columns: name, email, company, phone, notes, tags) |
| **Follow-ups** | Auto-scheduled at configurable intervals (default: 3, 7, 14 days) — also require approval |
| **Client Pipeline** | Track status: New → Contacted → Responded → Interested → Converted |
| **Google Sheets Sync** | Push all client data to a Google Sheet with one click |
| **Excel Export** | Download a `.xlsx` with Clients + Email History sheets |
| **Settings** | Configure follow-up intervals in the UI |

---

## CSV Import Format

```csv
name,email,company,phone,notes,tags
Jane Smith,jane@example.com,Acme Corp,+44 7700 000000,Met at conference,"saas,b2b"
```

---

## Project Structure

```
├── server.js                   # Express entry point
├── src/
│   ├── data/store.js           # JSON file-based data store
│   ├── routes/
│   │   ├── clients.js          # Client CRUD + CSV import
│   │   ├── emails.js           # Email queue, approve, send
│   │   ├── templates.js        # Template CRUD
│   │   └── sheets.js           # Google Sheets sync + Excel export
│   └── services/
│       ├── emailService.js     # Nodemailer + template rendering
│       ├── sheetsService.js    # Google Sheets API
│       └── followUpService.js  # Follow-up scheduler (cron)
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```
