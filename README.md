# Echo — Web3 AI Agent Marketplace

A Web3-native marketplace for AI agents built on Solana. Discover, chat with, and pay AI agents using USDC.

## Features

- 🤖 Discover and interact with AI agents
- 💰 Pay per session using USDC on Solana
- 🔐 Wallet-based authentication (Phantom)
- 🔊 Text-to-Speech for agent responses (ElevenLabs)
- 📎 File and image attachments in chat
- 🎨 Beautiful dark UI

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Phantom Wallet (for payments)

### Installation

```bash
npm install
```

### Environment Setup

1. Copy the example environment file:
```bash
cp .env.example .env.local
```

2. Fill in your API keys in `.env.local`:
```env
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Text-to-Speech (TTS) Setup

Echo uses ElevenLabs for text-to-speech functionality.

### Getting Your ElevenLabs API Key

1. Sign up at [ElevenLabs](https://elevenlabs.io)
2. Go to **Settings** → **API Keys**
3. Create a new API key
4. Copy it to your `.env.local` file

### Getting a Voice ID

1. Go to [Voice Library](https://elevenlabs.io/app/voice-library)
2. Browse or search for a voice you like
3. Click on the voice to see its details
4. Copy the Voice ID from the URL or settings
5. Add it to your `.env.local` as `ELEVENLABS_VOICE_ID`

**Popular Voice IDs:**
- Rachel (female): `21m00Tcm4TlvDq8ikWAM`
- Adam (male): `pNInz6obpgDQGcFmaJgB`
- Bella (female): `EXAVITQu4vr4xnSDxMaL`

Or use the API to list all available voices:
```bash
curl -H "xi-api-key: YOUR_API_KEY" https://api.elevenlabs.io/v1/voices
```

### Testing TTS

**Via curl:**
```bash
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is a test of the text to speech system."}' \
  --output test.mp3
```

**Via UI:**
1. Start a chat with any agent
2. Wait for an assistant response
3. Click the "🔊 Speak" button on any assistant message

## API Endpoints

### POST /api/tts

Convert text to speech using ElevenLabs.

**Request:**
```json
{
  "text": "Hello world",
  "voiceId": "optional_voice_id",
  "modelId": "eleven_multilingual_v2"
}
```

**Response:** `audio/mpeg` binary data

**Errors:**
```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE"
  }
}
```

### POST /api/solana-rpc

Proxy for Solana RPC calls (used for payments).

## Deployment

The app is configured for deployment on Vercel.

1. Push to GitHub
2. Connect your repo to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

## Security Notes

- API keys are **never** exposed to the frontend
- All sensitive operations go through server-side API routes
- Wallet private keys are **never** accessed by the app
- All payments require explicit user signing

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS
- Solana Web3.js
- ElevenLabs TTS API
- Vercel Serverless Functions

## License

MIT
