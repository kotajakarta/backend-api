import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module.js';
import { StudentService } from './src/modules/core/student/student.service.js';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const studentService = app.get(StudentService);
  
  try {
    const students = await studentService.getStudents({ scope: 'GLOBAL' });
    console.log("SUCCESS, found students:", students.length);
  } catch (err) {
    console.error("ERROR IN getStudents:");
    console.error(err);
  }
  
  try {
    const count = await studentService.getPendingPermintaanCount();
    console.log("SUCCESS, pending count:", count);
  } catch (err) {
    console.error("ERROR IN getPendingPermintaanCount:");
    console.error(err);
  }

  await app.close();
}

bootstrap().catch(console.error);
