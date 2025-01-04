import { createClient, type Provider } from '@supabase/supabase-js'
import { SUPABASE_CONFIG } from "../config"
import express from 'express'
import open from 'open'
import fs from 'fs'
import path from 'path'
import os from 'os'



export const supabase = createClient(
  SUPABASE_CONFIG.URL as string,
  SUPABASE_CONFIG.ANON_KEY as string
)

const TOKEN_FILE = path.join(os.homedir(), '.orbiter.json')

interface TokenData {
  access_token: string;
  refresh_token: string;
  created_at: string;
}

const isTokenExpired = (created_at: string): boolean => {
  const tokenDate = new Date(created_at);
  const now = new Date();
  // Tokens typically expire in 1 hour, so we'll refresh if it's older than 55 minutes
  const diffInMinutes = (now.getTime() - tokenDate.getTime()) / (1000 * 60);
  return diffInMinutes > 55;
};

// Function to refresh the token
export async function refreshToken(): Promise<TokenData | null> {
  const storedTokens = getStoredTokens();

  if (!storedTokens) {
    console.log('No stored tokens found. Please login first.');
    return null;
  }

  if (!isTokenExpired(storedTokens.created_at)) {
    return storedTokens;
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: storedTokens.refresh_token
    });

    if (error) {
      console.error('Error refreshing token:', error);
      return null;
    }

    if (!data.session) {
      console.error('No session returned when refreshing token');
      return null;
    }

    const newTokens = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      created_at: new Date().toISOString()
    };

    storeTokens(newTokens.access_token, newTokens.refresh_token);
    return newTokens;

  } catch (error) {
    console.error('Error refreshing token:', error);
    return null;
  }
}

export async function getValidTokens(): Promise<TokenData | null> {
  const storedTokens = getStoredTokens();

  if (!storedTokens) {
    console.log('No stored tokens found. Please login first.');
    return null;
  }

  if (isTokenExpired(storedTokens.created_at)) {
    return await refreshToken();
  }

  return storedTokens;
}



// Add function to store tokens
const storeTokens = (accessToken: string, refreshToken: string) => {
  const tokens: TokenData = {
    access_token: accessToken,
    refresh_token: refreshToken,
    created_at: new Date().toISOString()
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
};

// Add function to get stored tokens
const getStoredTokens = (): TokenData | undefined => {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf8');
      return JSON.parse(data) as TokenData;
    }
    return undefined;
  } catch (error) {
    console.error('Error reading token file:', error);
    return undefined;
  }
};

export async function login(provider: Provider) {
  try {
    const app = express()
    let serverHandle: any

    // Serve an HTML page that will parse the hash and send it to the server
    app.get('/', (req, res) => {
      res.send(`
        <html>
          <style>
            body html {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              display: flex;
              min-height: 100vh;
              width: 100%;
              justify-content: center;
              align-items: center;
              background: url("https://cdn.orbiter.host/ipfs/bafkreiahxtzvw7tjlbb3kseoi3mdmygespeem2dzasqslkciizzri24muq");
              background-size: cover;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              font-size: 48px;
              font-weight: bold;
              color: white;
            }

          </style>
          <body>
            <script>
              const hash = window.location.hash.substring(1);
              if (hash) {
                fetch('/callback?' + hash)
                  .then(() => {
                    document.body.innerHTML = '<p>Login successful! You can close this window.</p>';
                  })
                  .catch(() => {
                    document.body.innerHTML = '<p>Login failed. Please try again.</p>';
                  });
              }
            </script>
            <p>Processing login...</p>
          </body>
        </html>
        `);
    });

    // Start the server
    serverHandle = app.listen(54321, () => {
      console.log("Starting server on port 54321...")
    });


    // Handle the callback with the hash parameters
    app.get('/callback', async (req, res) => {
      try {
        const accessToken = req.query.access_token as string;
        const refreshToken = req.query.refresh_token as string;

        if (!accessToken) {
          console.error('No access token found');
          res.status(400).send('No access token found');
          return;
        }

        // Set the session
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (error) {
          console.error('Error setting session:', error);
          res.status(400).send('Error setting session');
          return;
        }

        storeTokens(accessToken, refreshToken);



        res.status(200).send('Success');

        // Close the server after successful login
        setTimeout(() => {
          serverHandle.close();
          process.exit(0);
        }, 1000);

      } catch (error) {
        console.error('Error in callback:', error);
        res.status(500).send('Internal server error');
      }
    });


    // Start the OAuth flow
    const { data: { url } } = await supabase.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: 'http://localhost:54321'
      }
    });

    // Open the browser
    await open(url as string);

    // Add a timeout
    setTimeout(() => {
      serverHandle.close();
      console.log('Authentication timed out. Please try again.');
      process.exit(1);
    }, 60000); // 1 minute timeout

  } catch (error) {
    console.error('Error during login:', error);
    process.exit(1);
  }

}
