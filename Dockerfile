FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (termasuk devDependencies untuk build)
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

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install hanya dependencies production
RUN npm install --omit=dev

# Generate Prisma client lagi khusus environment production
RUN npx prisma generate

# Copy hasil build dari stage builder
COPY --from=builder /app/dist ./dist

# Port aplikasi
EXPOSE 8080

# Jalankan aplikasi
CMD ["npm", "run", "start"]
