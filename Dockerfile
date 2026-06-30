# Backend (web/server) as a portable container — deploy on any container host
# that builds from a Dockerfile (Back4app, Koyeb, Hugging Face Spaces, Render…),
# most of which have a free tier with NO credit card required.
#
# The host injects PORT; the server reads process.env.PORT (falls back to 8787).
# No frontend build is copied, so the server runs API-only (frontend is on Pages).
FROM node:20-alpine

WORKDIR /app

# Install only server deps (better layer caching: deps change less than source).
COPY web/server/package*.json ./
RUN npm install --omit=dev

# App source.
COPY web/server/ ./

ENV NODE_ENV=production
# Informational; the platform's PORT env is what actually binds.
EXPOSE 8787

CMD ["node", "index.js"]
