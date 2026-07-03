import { defineConfig } from '@prisma/config';
import { config } from 'dotenv';

// Load .env explicitly because Prisma config presence disables automatic loading
config();

export default defineConfig({
  schema: 'prisma/schema',
  migrate: {
    url: process.env.DATABASE_URL,
  },
});
