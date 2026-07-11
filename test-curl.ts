import jwt from 'jsonwebtoken';
import { execSync } from 'child_process';

const payload = {
  id: 'test-admin-id',
  email: 'admin@test.com',
  name: 'Admin',
  scope: 'GLOBAL'
};
const token = jwt.sign(payload, 'h9yCgsudXarNY1CsuYe0cGrNUTT1cpidJrTxZmvQnw0', { expiresIn: '1d' });

try {
  const result = execSync(`curl -s -v -H "Authorization: Bearer ${token}" http://localhost:8080/api/v1/students`);
  console.log("RESPONSE_LENGTH:", result.length);
  if (result.length < 500) {
    console.log("RESPONSE:", result.toString());
  }
} catch (e: any) {
  console.error("CURL ERROR:", e.stdout.toString(), e.stderr.toString());
}
