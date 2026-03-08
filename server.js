import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoConnector from './config/mongoConnector.js';
import leadRoutes from './routes/leadRoutes.js';
import ssoRoutes from './routes/ssoRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import ssoAuthMiddleware from './middleware/ssoAuthMiddleware.js';
import { loadSecretsFromAWS } from './config/secretsManager.js';

// AWS Secrets Manager - loads secrets into process.env
const hasAWSCredentials = process.env.AWS_SECRET_MANAGER_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_MANAGER_SECRET_ACCESS_KEY;

if (hasAWSCredentials) {
  console.log('[Startup] Loading secrets from AWS Secrets Manager...');
  try {
    await loadSecretsFromAWS();
    console.log('[Startup] ✓ Successfully loaded secrets from AWS Secrets Manager');
  } catch (error) {
    console.error('[Startup] ⚠ Failed to load secrets from AWS:', error.message);
    console.error('[Startup] Continuing with environment variables only');
    // Don't exit - allow app to continue with .env variables
  }
} else {
  console.log('[Startup] AWS Secrets Manager not configured, using environment variables');
}

const app = express();
const PORT = process.env.PORT || 8081;

// Parse allowed origins from environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

// Enable CORS with credentials for SSO cookie support
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In development/local, allow any localhost origin
      if ((process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'local')
        && origin.startsWith('http://localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true, // REQUIRED for SSO cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Set-Cookie']
}));

// Cookie parser - REQUIRED for SSO authentication
app.use(cookieParser());

// JSON and URL-encoded body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoConnector.connect()
  .then(() => {
    console.log('MongoDB connected successfully');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// SSO Routes
app.use('/api/sso', ssoRoutes);

// Auth Routes (alias for SSO routes to support /api/auth endpoints)
app.use('/api/auth', ssoRoutes);

// UI SSO Routes (alias for frontend UI)
app.use('/api/ui/sso', ssoRoutes);

// Login redirect route
app.get('/login', (req, res) => {
  const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:8081';
  const redirectUrl = req.query.redirect || process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
  const encodedRedirect = encodeURIComponent(redirectUrl);

  // Redirect to SSO auth service login page
  res.redirect(`${authServiceUrl}/login?redirect=${encodedRedirect}`);
});

// Account Routes — protected by SSO authentication
// POST /api/accounts/verify
// POST /api/accounts/link-user
app.use('/api/accounts', accountRoutes);

// Lead Routes — protected by SSO authentication
app.use('/api/leads', ssoAuthMiddleware, leadRoutes);

// Analytics Routes — protected by SSO authentication
app.use('/api/analytics', ssoAuthMiddleware, analyticsRoutes);

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
