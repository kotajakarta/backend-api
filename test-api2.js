import jwt from 'jsonwebtoken';
import fs from 'fs';

const secret = "h9yCgsudXarNY1CsuYe0cGrNUTT1cpidJrTxZmvQnw0";
const payload = {
  id: "0a661c74-2a4e-4201-a669-8897ddd6f873",
  username: "cabang1",
  scope: "CABANG",
  cabangId: "633b3833-afb7-4a10-9627-cd9b0cfbed53",
  wilayahId: "d15a25fa-b336-436d-b2fc-e915d183f8b5"
};

const token = jwt.sign(payload, secret, {
  issuer: "edaimi-backend-api",
  audience: "edaimi-clients",
  expiresIn: "1h"
});

console.log("TOKEN=" + token);
