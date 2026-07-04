import jwt from 'jsonwebtoken';
import fs from 'fs';

const secret = "h9yCgsudXarNY1CsuYe0cGrNUTT1cpidJrTxZmvQnw0";
// Create a payload for a Cabang user
const payload = {
  id: "some-user-id",
  username: "testcabang",
  scope: "CABANG",
  cabangId: "715e252f-9b7b-4740-9402-ed5e850947db", // valid cabang from DB
  wilayahId: "d15a25fa-b336-436d-b2fc-e915d183f8b5" // valid wilayah from DB
};

const token = jwt.sign(payload, secret, {
  issuer: "edaimi-backend-api",
  audience: "edaimi-clients",
  expiresIn: "1h"
});

console.log("Token:", token);
