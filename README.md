# Virtual Try-On

Upload a photo of yourself, pick an outfit, and see how it looks on you. Uses Gemini and Grok AI for image generation.

## Quick Setup

Deploy on [hoston.ai](https://hoston.ai) - paste this:

```
copy this project and setup https://github.com/buyhostname/changefit.site
```

## Manual Setup

See [AGENTS.md](./AGENTS.md) for full instructions.

```bash
npm install
cp .env.example .env
npx prisma generate && npx prisma db push
npm start
```

## License

MIT
