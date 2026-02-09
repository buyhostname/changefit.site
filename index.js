require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const crypto = require('crypto');

const app = express();
const prisma = new PrismaClient();

app.set('trust proxy', true);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'catsanddogs1234';

// Initialize app config
async function initConfig() {
    let config = await prisma.appConfig.findUnique({ where: { id: 1 } });
    if (!config) {
        const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
        config = await prisma.appConfig.create({
            data: { id: 1, passwordHash: hash, jwtVersion: 1 }
        });
    }
    return config;
}

// Generate JWT
function generateToken(sessionId, jwtVersion, hasServerKeys = true) {
    return jwt.sign({ sessionId, version: jwtVersion, hasServerKeys }, JWT_SECRET, { expiresIn: '30d' });
}

// Verify JWT middleware
async function authMiddleware(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login');
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const config = await prisma.appConfig.findUnique({ where: { id: 1 } });
        if (decoded.version !== config.jwtVersion) {
            res.clearCookie('token');
            return res.redirect('/login');
        }
        req.sessionId = decoded.sessionId;
        req.hasServerKeys = decoded.hasServerKeys;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
}

// Serve bridge.js dynamically
app.get('/bridge.js', (req, res) => {
    const host = req.hostname;
    const adminHost = host.startsWith('admin.') ? host : 'admin.' + host;
    
    res.type('application/javascript');
    res.send(`
(function() {
    const ADMIN_URL = 'wss://${adminHost}/bridge';
    
    let ws;
    let reconnectTimer;
    let clientId = null;
    
    const handlers = {
        navigate: async (action) => {
            const url = action.url;
            setTimeout(() => { window.location.href = url; }, 50);
            return { navigating: url };
        },
        
        fill: async (action) => {
            const el = document.querySelector(action.selector);
            if (!el) throw new Error('Element not found: ' + action.selector);
            el.value = action.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { filled: action.selector, value: action.value };
        },
        
        click: async (action) => {
            const el = document.querySelector(action.selector);
            if (!el) throw new Error('Element not found: ' + action.selector);
            el.click();
            return { clicked: action.selector };
        },
        
        type: async (action) => {
            const el = document.querySelector(action.selector);
            if (!el) throw new Error('Element not found: ' + action.selector);
            el.focus();
            for (const char of action.text) {
                el.value += char;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, action.delay || 20));
            }
            return { typed: action.text.length + ' chars' };
        },
        
        wait: async (action) => {
            if (action.selector) {
                const start = Date.now();
                const timeout = action.timeout || 10000;
                while (Date.now() - start < timeout) {
                    if (document.querySelector(action.selector)) {
                        return { found: action.selector };
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
                throw new Error('Timeout waiting for: ' + action.selector);
            } else if (action.ms) {
                await new Promise(r => setTimeout(r, action.ms));
                return { waited: action.ms };
            }
        },
        
        eval: async (action) => {
            const result = await eval(action.code);
            if (result instanceof Element) return result.outerHTML;
            if (result instanceof NodeList || Array.isArray(result)) {
                return Array.from(result).map(el => el instanceof Element ? el.outerHTML : el);
            }
            return result;
        },
        
        get: async (action) => {
            const el = document.querySelector(action.selector);
            if (!el) throw new Error('Element not found: ' + action.selector);
            return {
                text: el.innerText,
                value: el.value,
                html: action.html ? el.innerHTML : undefined
            };
        }
    };
    
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        
        try {
            ws = new WebSocket(ADMIN_URL);
            
            ws.onopen = () => {
                console.log('[bridge] connected to', ADMIN_URL);
                ws.send(JSON.stringify({ type: 'hello', url: location.href }));
            };
            
            ws.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    
                    if (msg.type === 'welcome') {
                        clientId = msg.clientId;
                        console.log('[bridge] assigned client ID:', clientId);
                        return;
                    }
                    
                    if (msg.type === 'task') {
                        let result, error;
                        try {
                            if (msg.action && handlers[msg.action.type]) {
                                result = await handlers[msg.action.type](msg.action);
                            } else if (msg.code) {
                                result = await eval(msg.code);
                                if (result instanceof Element) result = result.outerHTML;
                                if (result instanceof NodeList || Array.isArray(result)) {
                                    result = Array.from(result).map(el => el instanceof Element ? el.outerHTML : el);
                                }
                            }
                        } catch (e) {
                            error = e.message;
                        }
                        ws.send(JSON.stringify({ type: 'result', taskId: msg.taskId, result, error }));
                    }
                } catch (e) {
                    console.error('[bridge] message error:', e);
                }
            };
            
            ws.onclose = () => {
                console.log('[bridge] disconnected, reconnecting in 3s...');
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connect, 3000);
            };
            
            ws.onerror = (e) => {
                console.error('[bridge] error:', e);
            };
        } catch (e) {
            console.error('[bridge] connection error:', e);
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 3000);
        }
    }
    
    connect();
})();
`);
});

// Login page
app.get('/login', async (req, res) => {
    await initConfig();
    res.render('login', { title: 'Login' });
});

// Login with password
app.post('/login', async (req, res) => {
    const { password } = req.body;
    const config = await initConfig();
    
    const valid = await bcrypt.compare(password, config.passwordHash);
    if (!valid) {
        return res.render('login', { title: 'Login', error: 'Invalid password' });
    }
    
    // Create session
    const session = await prisma.userSession.create({ data: {} });
    const token = generateToken(session.id, config.jwtVersion, true);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
});

// Continue without password (must provide own keys)
app.post('/login/guest', async (req, res) => {
    const config = await initConfig();
    const session = await prisma.userSession.create({ data: {} });
    const token = generateToken(session.id, config.jwtVersion, false);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
});

// Change password
app.post('/settings/password', authMiddleware, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    const hash = await bcrypt.hash(newPassword, 10);
    const config = await prisma.appConfig.update({
        where: { id: 1 },
        data: { passwordHash: hash, jwtVersion: { increment: 1 } }
    });
    
    // Generate new token for current user
    const token = generateToken(req.sessionId, config.jwtVersion, req.hasServerKeys);
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
});

// Save user API keys
app.post('/settings/keys', authMiddleware, async (req, res) => {
    const { geminiKey, xaiKey } = req.body;
    await prisma.userSession.update({
        where: { id: req.sessionId },
        data: { geminiKey, xaiKey }
    });
    res.json({ success: true });
});

// Get user settings
app.get('/api/settings', authMiddleware, async (req, res) => {
    const session = await prisma.userSession.findUnique({ where: { id: req.sessionId } });
    res.json({
        hasServerKeys: req.hasServerKeys,
        geminiKey: session?.geminiKey || '',
        xaiKey: session?.xaiKey || '',
        lastPrompt: session?.lastPrompt || ''
    });
});

// Save custom wardrobe item (only for password-authenticated users)
app.post('/api/wardrobe/save', authMiddleware, upload.single('wardrobeImage'), async (req, res) => {
    try {
        // Only allow password-authenticated users to save
        if (!req.hasServerKeys) {
            return res.status(403).json({ error: 'Only password-authenticated users can save wardrobe items' });
        }
        
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No image provided' });
        }
        
        // Ensure wardrobe directory exists
        const wardrobePath = path.join(__dirname, 'public', 'wardrobe');
        if (!fs.existsSync(wardrobePath)) {
            fs.mkdirSync(wardrobePath, { recursive: true });
        }
        
        // Generate random filename
        const randomName = crypto.randomBytes(16).toString('hex') + '.png';
        
        // Save the image
        fs.writeFileSync(path.join(wardrobePath, randomName), file.buffer);
        
        res.json({ success: true, filename: randomName });
    } catch (err) {
        console.error('Save wardrobe error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get list of available wardrobe presets
app.get('/api/wardrobe/list', authMiddleware, (req, res) => {
    const wardrobePath = path.join(__dirname, 'public', 'wardrobe');
    let presets = [];
    
    if (fs.existsSync(wardrobePath)) {
        presets = fs.readdirSync(wardrobePath)
            .filter(f => f.endsWith('.png'))
            .map(f => f.replace('.png', ''));
    }
    
    res.json({ presets, canSave: req.hasServerKeys });
});

// Save prompt
app.post('/api/prompt', authMiddleware, async (req, res) => {
    const { prompt } = req.body;
    await prisma.userSession.update({
        where: { id: req.sessionId },
        data: { lastPrompt: prompt }
    });
    res.json({ success: true });
});

// Clear prompt
app.post('/api/prompt/clear', authMiddleware, async (req, res) => {
    await prisma.userSession.update({
        where: { id: req.sessionId },
        data: { lastPrompt: null }
    });
    res.json({ success: true });
});

// Logout
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// Main app page
app.get('/', authMiddleware, async (req, res) => {
    const session = await prisma.userSession.findUnique({ where: { id: req.sessionId } });
    res.render('app', {
        title: 'Virtual Try-On',
        hasServerKeys: req.hasServerKeys,
        lastPrompt: session?.lastPrompt || ''
    });
});

// Generate image with AI
app.post('/api/generate', authMiddleware, upload.fields([
    { name: 'personImage', maxCount: 1 },
    { name: 'wardrobeImage', maxCount: 1 }
]), async (req, res) => {
    try {
        const { providers, prompt, wardrobePreset } = req.body;
        const selectedProviders = JSON.parse(providers || '[]');
        
        if (!selectedProviders.length) {
            return res.status(400).json({ error: 'Select at least one provider' });
        }
        
        const session = await prisma.userSession.findUnique({ where: { id: req.sessionId } });
        
        // Get API keys
        let geminiKey = req.hasServerKeys ? process.env.GEMINI_API_KEY : session?.geminiKey;
        let xaiKey = req.hasServerKeys ? process.env.XAI_API_KEY : session?.xaiKey;
        
        // Get images
        const personImage = req.files['personImage']?.[0];
        let wardrobeImage = req.files['wardrobeImage']?.[0];
        
        if (!personImage) {
            return res.status(400).json({ error: 'Person image is required' });
        }
        
        // If using preset, load it
        let wardrobeBuffer = wardrobeImage?.buffer;
        if (wardrobePreset && !wardrobeImage) {
            const presetPath = path.join(__dirname, 'public', 'wardrobe', `${wardrobePreset}.png`);
            if (fs.existsSync(presetPath)) {
                wardrobeBuffer = fs.readFileSync(presetPath);
            }
        }
        
        // Save prompt
        await prisma.userSession.update({
            where: { id: req.sessionId },
            data: { lastPrompt: prompt || '' }
        });
        
        const results = [];
        
        // Process each selected provider
        for (const provider of selectedProviders) {
            try {
                if (provider === 'gemini' && geminiKey) {
                    const result = await generateWithGemini(geminiKey, personImage.buffer, wardrobeBuffer, prompt);
                    results.push({ provider: 'Gemini', ...result });
                } else if (provider === 'grok-imagine-image' && xaiKey) {
                    const result = await generateWithXai(xaiKey, 'grok-imagine-image', personImage.buffer, wardrobeBuffer, prompt);
                    results.push({ provider: 'Grok Imagine Image', ...result });
                } else if (provider === 'grok-imagine-image-pro' && xaiKey) {
                    const result = await generateWithXai(xaiKey, 'grok-imagine-image-pro', personImage.buffer, wardrobeBuffer, prompt);
                    results.push({ provider: 'Grok Imagine Image Pro', ...result });
                } else {
                    results.push({ provider, error: 'API key not available' });
                }
            } catch (err) {
                console.error(`Error with ${provider}:`, err);
                results.push({ provider, error: err.message });
            }
        }
        
        res.json({ results });
    } catch (err) {
        console.error('Generate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Gemini image generation
async function generateWithGemini(apiKey, personBuffer, wardrobeBuffer, prompt) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: 'gemini-3-pro-image-preview',
        generationConfig: { responseModalities: ['image', 'text'] }
    });
    
    const imageParts = [
        {
            inlineData: {
                mimeType: 'image/png',
                data: personBuffer.toString('base64')
            }
        }
    ];
    
    if (wardrobeBuffer) {
        imageParts.push({
            inlineData: {
                mimeType: 'image/png',
                data: wardrobeBuffer.toString('base64')
            }
        });
    }
    
    const fullPrompt = wardrobeBuffer 
        ? `Virtual try-on: Take the person from the first image and dress them in the clothing/outfit shown in the second image. ${prompt || 'Make it look natural and realistic.'}`
        : `Virtual try-on: ${prompt || 'Generate a fashionable outfit for this person.'}`;
    
    const result = await model.generateContent([fullPrompt, ...imageParts]);
    const response = await result.response;
    
    // Extract image from response
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            return { 
                image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                text: response.text() || ''
            };
        }
    }
    
    return { error: 'No image generated', text: response.text() || '' };
}

// xAI Grok image generation
async function generateWithXai(apiKey, model, personBuffer, wardrobeBuffer, prompt) {
    const personBase64 = personBuffer.toString('base64');
    const wardrobeBase64 = wardrobeBuffer ? wardrobeBuffer.toString('base64') : null;
    
    const messages = [{
        role: 'user',
        content: []
    }];
    
    // Add person image
    messages[0].content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${personBase64}` }
    });
    
    // Add wardrobe image if available
    if (wardrobeBase64) {
        messages[0].content.push({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${wardrobeBase64}` }
        });
    }
    
    const fullPrompt = wardrobeBase64
        ? `Virtual try-on: Take the person from the first image and dress them in the clothing/outfit shown in the second image. ${prompt || 'Make it look natural and realistic.'} Generate an image showing the result.`
        : `Virtual try-on: ${prompt || 'Generate a fashionable outfit for this person.'} Generate an image showing the result.`;
    
    messages[0].content.push({ type: 'text', text: fullPrompt });
    
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            messages: messages
        })
    });
    
    const data = await response.json();
    
    if (data.error) {
        throw new Error(data.error.message || 'xAI API error');
    }
    
    // Extract image URL from response
    const content = data.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
        for (const part of content) {
            if (part.type === 'image_url' || part.image_url) {
                return { image: part.image_url?.url || part.url };
            }
        }
    }
    
    // Check for image in different response formats
    if (data.choices?.[0]?.message?.image) {
        return { image: data.choices[0].message.image };
    }
    
    return { text: typeof content === 'string' ? content : JSON.stringify(content), error: 'No image in response' };
}

// 404 handler
app.use((req, res, next) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        status: 404,
        message: 'The page you are looking for does not exist.'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).render('error', {
        title: 'Error',
        status: err.status || 500,
        message: process.env.PRODUCTION === 'true' ? 'Something went wrong.' : err.message
    });
});

// Start server
initConfig().then(() => {
    app.listen(PORT, () => {
        console.log(`Virtual Try-On app running on port ${PORT}`);
    });
});
