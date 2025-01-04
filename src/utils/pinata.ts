import { PinataSDK } from "pinata-web3";
import fs from "fs"
import path from "path"
import { getValidTokens, supabase } from "./auth";

const pinata = new PinataSDK({
  pinataJwt: "",
  pinataGateway: ""
})

async function upload(filePath: string, key: string, userId: string) {
  const distPath = path.join(process.cwd(), filePath);
  const files: File[] = [];

  function readDirRecursively(dir: string) {
    try {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          readDirRecursively(fullPath);
        } else {
          const fileContent = fs.readFileSync(fullPath);
          const relativePath = path.relative(distPath, fullPath);
          const file = new File([fileContent], relativePath);
          files.push(file);
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
      throw error;
    }
  }

  // Call readDirRecursively before checking files.length
  readDirRecursively(distPath);

  let result;
  if (files.length > 1) {
    result = await pinata.upload.fileArray(files)
      .key(key)
      .group("c5e8c379-e7c1-4c43-a2e9-79597d477481")
      .addMetadata({
        keyValues: {
          userId: userId
        }
      });
  } else if (files.length === 1) {
    result = await pinata.upload.file(files[0])
      .key(key)
      .group("c5e8c379-e7c1-4c43-a2e9-79597d477481")
      .addMetadata({
        keyValues: {
          userId: userId
        }
      });
  } else {
    throw new Error(`No files found to upload in directory: ${distPath}`);
  }

  return result;
}


export async function uploadSite(filePath: string) {
  try {
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      return;
    }

    await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      console.log('No active session found');
      return;
    }

    const keyReq = await fetch("https://api.orbiter.host/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token
      },
      body: JSON.stringify({}),
    })
    const keyRes = await keyReq.json()
    const result = await upload(filePath, keyRes.data, session.user.id)
    return result
  } catch (error) {
    console.log(error)
  }
}
