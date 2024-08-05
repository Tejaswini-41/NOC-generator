import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

// Load environment variables from the .env file inside the config directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, 'config', '.env') });

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH;
const TOKEN_PATH = process.env.TOKEN_PATH;

//console.log('CREDENTIALS_PATH:', CREDENTIALS_PATH);
//console.log('TOKEN_PATH:', TOKEN_PATH);

if (!CREDENTIALS_PATH || !TOKEN_PATH) {
  console.error('Environment variables for paths are not defined.');
  process.exit(1);
}

const fullCredentialsPath = path.resolve(__dirname, CREDENTIALS_PATH);
const fullTokenPath = path.resolve(__dirname, TOKEN_PATH);

async function authenticate() {
  const credentials = JSON.parse(fs.readFileSync(fullCredentialsPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]
  );

  try {
    const token = JSON.parse(fs.readFileSync(fullTokenPath));
    oAuth2Client.setCredentials(token);
  } catch (err) {
    console.error('Error loading token:', err);
    return null;
  }
  return oAuth2Client;
}

async function listCourses(auth) {
  const classroom = google.classroom({ version: 'v1', auth });
  try {
    const res = await classroom.courses.list();
    if (res.data.courses.length) {
      console.log('Courses:');
      res.data.courses.forEach(course => {
        console.log(`${course.name} (${course.id})`);
      });
    } else {
      console.log('No courses found.');
    }
  } catch (err) {
    console.error('Error retrieving courses:', err);
  }
}

async function main() {
  const auth = await authenticate();
  if (auth) {
    await listCourses(auth);
  }
}

main();
