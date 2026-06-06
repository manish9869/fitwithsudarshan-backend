# FitWithSudarshan Backend

Production Express API for Razorpay payment integration.

## Stack
- **Express** — HTTP server
- **Helmet** — Security headers
- **express-rate-limit** — DDoS / brute-force protection
- **cors** — Origin whitelisting
- **winston** — Structured logging
- **morgan** — HTTP request logging
- **compression** — Gzip responses

## Folder Structure
```
src/
├── app.js                  # Entry point — middleware + server boot
├── config/
│   ├── env.js              # Env validation + typed config object
│   └── logger.js           # Winston logger setup
├── controllers/
│   └── paymentController.js # Business logic (create order, verify payment)
├── middleware/
│   ├── errorHandler.js     # 404 + global error handler
│   ├── requestLogger.js    # Morgan → Winston stream
│   └── security.js         # Helmet, CORS, rate limiters, compression
├── routes/
│   └── payment.js          # Route definitions
└── utils/
    ├── razorpay.js         # Razorpay REST API calls + signature verification
    └── validate.js         # Input validation helpers
logs/
├── error.log               # Error-level logs only
└── combined.log            # All logs
```

## Local Setup
```bash
cp .env.example .env
# Fill in your Razorpay keys
npm install
npm run dev
```

## Env Variables
| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default 3001) |
| `NODE_ENV` | No | `development` or `production` |
| `RAZORPAY_KEY_ID` | ✅ | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | ✅ | Razorpay secret |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins |

## API Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/create-order` | Create Razorpay order |
| POST | `/api/verify-payment` | Verify payment signature |

## Deploy on Vercel
```bash
vercel --prod
```
Add env vars in Vercel dashboard → Settings → Environment Variables.
