import { PinataSDK } from "pinata-web3";
import fs from "fs"
import path from "path"
import { getValidTokens, supabase } from "./auth";

const pinata = new PinataSDK({
  pinataJwt: "",
  pinataGateway: ""
})

async function upload(filePath: string, key: string) {
  const absolutePath = path.join(process.cwd(), filePath);
  const files: File[] = [];

  // Check if path is a file or directory
  const stats = fs.statSync(absolutePath);

  if (stats.isFile()) {
    // Handle single file
    const fileContent = fs.readFileSync(absolutePath);
    const file = new File([fileContent], path.basename(absolutePath));
    files.push(file);
  } else if (stats.isDirectory()) {
    // Handle directory
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
            const relativePath = path.relative(absolutePath, fullPath);
            const file = new File([fileContent], relativePath);
            files.push(file);
          }
        }
      } catch (error) {
        console.error(`Error reading directory ${dir}:`, error);
        throw error;
      }
    }

    readDirRecursively(absolutePath);
  } else {
    throw new Error(`Path ${absolutePath} is neither a file nor a directory`);
  }

  if (files.length === 0) {
    throw new Error(`No files found to upload at path: ${absolutePath}`);
  }

  // Upload files
  const result = files.length === 1
    ? await pinata.upload.file(files[0])
      .key(key)
      .group("c5e8c379-e7c1-4c43-a2e9-79597d477481")
    : await pinata.upload.fileArray(files)
      .key(key)
      .group("c5e8c379-e7c1-4c43-a2e9-79597d477481")

  return result;
}


export async function uploadSite(filePath: string) {
  try {
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      return;
    }

    if (tokens.keyType === "oauth") {
      await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token as string
      });
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        console.log('No active session found');
        return;
      }
    }

    const keyReq = await fetch("https://api.orbiter.host/keys/upload_key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tokens.keyType === 'apikey'
          ? { "X-Orbiter-API-Key": `${tokens.access_token}` }
          : { "X-Orbiter-Token": tokens.access_token })
      },
      body: JSON.stringify({}),
    })
    const keyRes = await keyReq.json()
    const result = await upload(filePath, keyRes.data)
    return result
  } catch (error) {
    console.log(error)
  }
}
