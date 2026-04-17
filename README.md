# Bachelor Meal Planner

Mobile-first meal planner with Supabase backend, prep timers, and browser notifications.

## Deploy to Netlify (drag & drop)
1. Go to https://app.netlify.com
2. Drag the entire `bachelor-meal-planner` folder onto the Netlify dashboard
3. Done — your app is live in seconds

## Deploy to Netlify (CLI)
```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

## Deploy to Vercel (CLI)
```bash
npm install -g vercel
vercel --prod
```

## Project structure
```
bachelor-meal-planner/
├── index.html       # App shell
├── style.css        # Mobile-first dark theme
├── app.js           # Supabase logic, timers, notifications
├── netlify.toml     # Netlify config
├── vercel.json      # Vercel config
└── README.md
```

## Supabase tables
- `meals` — master meal list (seeded with 48 meals)
- `meal_logs` — daily meal entries
- `daily_summaries` — per-day totals

## Features
- Grouped dropdown by category
- Prep/soak timer with live countdown
- Browser push notification when prep is done
- History drawer with past 30 days
- Fully persisted to Supabase
