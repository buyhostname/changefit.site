# Virtual Try-On

Upload a photo of yourself, pick an outfit, and see how it looks on you. Uses Gemini and Grok AI for image generation.

## Quick Setup

Deploy on [hoston.ai](https://hoston.ai) - paste this:

```
copy this project and setup https://github.com/buyhostname/changefit.site
```

<img width="603" height="1311" alt="IMG_8481" src="https://github.com/user-attachments/assets/785e00a9-23e8-451e-88d4-df49d197435d" />
<img width="603" height="1311" alt="IMG_8482" src="https://github.com/user-attachments/assets/1e522551-5a5a-43bd-8d7e-aec5dbd27211" />

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
