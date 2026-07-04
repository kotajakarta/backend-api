import jwt from 'jsonwebtoken';
const secret = "h9yCgsudXarNY1CsuYe0cGrNUTT1cpidJrTxZmvQnw0";
const payload = {
  id: "7f80e6c1-c975-4acb-bf64-789467090345", // global admin
  username: "admin",
  scope: "GLOBAL"
};
const token = jwt.sign(payload, secret, {
  issuer: "edaimi-backend-api",
  audience: "edaimi-clients",
  expiresIn: "1h"
});
console.log("TOKEN=" + token);
