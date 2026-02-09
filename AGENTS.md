# AGENTS.md - Virtual Try-On App Setup Guide

This document describes how to recreate this project from scratch on a fresh server.

## Overview

Virtual Try-On is an AI-powered outfit visualization app. Users upload a photo of themselves and select/upload clothing items to see how outfits would look on them. Uses Gemini and xAI (Grok) for image generation.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL + Prisma ORM
- **Template Engine**: Pug
- **Process Manager**: PM2
- **Reverse Proxy**: Nginx
- **Auth**: JWT (cookie-based)

## Project Structure

```
/root/main/
├── index.js           # Main Express server
├── package.json       # Dependencies
├── .env               # Environment variables
├── prisma/
│   └── schema.prisma  # Database schema
├── views/
│   ├── layout.pug     # Base template
│   ├── login.pug      # Login page
│   ├── setup.pug      # API key setup (guests)
│   └── app.pug        # Main app
├── public/
│   └── wardrobe/      # Saved outfit presets (PNG files)
└── uploads/           # Temporary upload directory
```

## Setup Instructions

### 1. System Dependencies

```bash
apt update
apt install -y nodejs npm nginx mysql-server certbot python3-certbot-nginx
npm install -g pm2
```

### 2. MySQL Setup

```bash
mysql -u root -e "CREATE DATABASE tryon;"
mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';"
mysql -u root -e "FLUSH PRIVILEGES;"
```

### 3. Clone & Install

```bash
cd /root
git clone https://github.com/buyhostname/changefit.site main
cd main
npm install
```

### 4. Environment Configuration

```bash
cp .env.example .env
# Edit .env with your values:
# - JWT_SECRET: Generate a secure random string
# - GEMINI_API_KEY: Get from https://aistudio.google.com/app/apikey
# - XAI_API_KEY: Get from https://console.x.ai/team/default/api-keys
# - DEFAULT_PASSWORD: Initial login password
# - DATABASE_URL: MySQL connection string
```

### 5. Database Migration

```bash
npx prisma generate
npx prisma db push
```

### 6. Create Required Directories

```bash
mkdir -p public/wardrobe uploads
chmod 755 public/wardrobe uploads
```

### 7. Nginx Configuration

Create `/etc/nginx/sites-available/changefit.site`:

```nginx
server {
    listen 80;
    server_name changefit.site www.changefit.site;
    
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and start:

```bash
ln -s /etc/nginx/sites-available/changefit.site /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 8. SSL Certificate

```bash
certbot --nginx -d changefit.site -d www.changefit.site
```

### 9. Start Application

```bash
pm2 start npm --name "main-3000" -- start
pm2 save
pm2 startup
```

## Key Features

### Authentication
- Password-based login for full access (server API keys)
- Guest mode: users provide their own API keys
- JWT stored in HTTP-only cookie

### Image Generation
- **Gemini**: Google's generative AI for image editing
- **Grok**: xAI's image generation (standard and pro models)

### Wardrobe System
- Pre-saved outfit presets in `/public/wardrobe/`
- Users can upload custom outfits
- Authenticated users can save outfits to presets

### User Data
- Person photo saved to localStorage (client-side)
- Prompts and API keys saved per session (server-side)

## API Endpoints

- `POST /login` - Password authentication
- `POST /login/guest` - Start guest session
- `POST /setup` - Save guest API keys
- `GET /logout` - Clear session
- `GET /api/settings` - Get user settings
- `POST /api/generate` - Generate try-on image
- `GET /api/wardrobe/list` - List preset outfits
- `POST /api/wardrobe/save` - Save outfit to presets
- `POST /settings/password` - Change password
- `POST /settings/keys` - Update API keys

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `PRODUCTION` | Enable production mode |
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_VERSION` | Increment to invalidate all tokens |
| `GEMINI_API_KEY` | Google AI API key (optional for guest mode) |
| `XAI_API_KEY` | xAI API key (optional for guest mode) |
| `DEFAULT_PASSWORD` | Initial login password |
| `DATABASE_URL` | MySQL connection string |

## Troubleshooting

### Check logs
```bash
pm2 logs main-3000
```

### Restart app
```bash
pm2 restart main-3000
```

### Reset database
```bash
npx prisma db push --force-reset
```

### Test locally
```bash
curl http://localhost:3000/login
```
