# AI College Search Backend (Terminal)

Node.js CLI backend for natural language college search using Azure OpenAI + MySQL.

## 1) Setup

- Install dependencies:
  - `npm install`
- Create env file:
  - Copy `.env.example` to `.env`
- Fill Azure OpenAI and MySQL credentials in `.env`

## 2) Run

- Interactive mode:
  - `npm run search`
- Direct query mode:
  - `node src/cli.js "MBA college in Nagpur"`

## 3) What it does

- Sends natural language query to Azure OpenAI to extract JSON filters.
- Builds parameterized SQL dynamically across all required joined tables.
- Always enforces active and non-deleted records.
- If AI fails, falls back to keyword search on college name.
- If no results, relaxes filters in this order:
  - specialization
  - city
- Logs each search attempt to `logs/ai-search.log`.

## 4) Output

CLI prints:
- detected filters
- total colleges found
- table preview of matching colleges
