FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY tsconfig.json ./

# Install dependencies (termasuk devDependencies untuk build & prisma)
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy seluruh source code
COPY . .

# Build aplikasi TypeScript
RUN npm run build

# --- Stage Production ---
FROM node:20-alpine AS runner

WORKDIR /app

# Set NODE_ENV ke production
ENV NODE_ENV=production

# Copy configurations
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Copy node_modules beserta prisma generated client dari builder
COPY --from=builder /app/node_modules ./node_modules

# Copy hasil build dari stage builder
COPY --from=builder /app/dist ./dist

# Port aplikasi
EXPOSE 8080

# Jalankan aplikasi
CMD ["npm", "run", "start"]
