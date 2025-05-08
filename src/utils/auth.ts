import { createClient, type Provider } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "../config";
//@ts-ignore
import express, { Request, Response } from "express";
import open from "open";
import fs from "fs";
import path from "path";
import os from "os";
import ora, { type Ora } from "ora";
import inquirer from "inquirer";

let spinner: Ora;

export const supabase = createClient(
	SUPABASE_CONFIG.URL as string,
	SUPABASE_CONFIG.ANON_KEY as string,
);

const TOKEN_FILE = path.join(os.homedir(), ".orbiter.json");
const ORG_FILE = path.join(os.homedir(), ".orbiter-org.json");
const ORBITER_API_KEY = "ORBITER_API_KEY";

interface OrgData {
	id: string;
	name: string;
	selected_at: string;
}

interface TokenData {
	access_token: string;
	refresh_token?: string;
	created_at: string;
	keyType: "oauth" | "apikey";
}

export async function authenticateWithApiKey(providedKey?: string) {
	try {
		let apiKey: string;

		if (providedKey) {
			apiKey = providedKey;
		} else {
			const response = await inquirer.prompt([
				{
					type: "password",
					name: "apiKey",
					message: "Please enter your API key:",
					validate: (input) => input.length > 0 || "API key cannot be empty",
				},
			]);
			apiKey = response.apiKey;
		}

		// Verify the API key by making a test request
		const testResponse = await fetch(`https://api.orbiter.host/sites`, {
			headers: {
				"X-Orbiter-API-Key": `${apiKey}`,
			},
		});

		if (!testResponse.ok) {
			console.error("Invalid API key");
			return;
		}

		// Store the API key
		const tokens: TokenData = {
			access_token: apiKey,
			created_at: new Date().toISOString(),
			keyType: "apikey",
		};

		fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
		console.log("API key stored successfully");

		// // Get and store org information if available
		// const orgResponse = await fetch(`${API_URL}/org`, {
		//   headers: {
		//     'Authorization': `Bearer ${apiKey}`
		//   }
		// });

		// if (orgResponse.ok) {
		//   const orgData = await orgResponse.json();
		//   storeSelectedOrg(orgData.id, orgData.name);
		// }
	} catch (error) {
		console.error("Error storing API key:", error);
	}
}

export function storeSelectedOrg(orgId: string, orgName: string) {
	const orgData: OrgData = {
		id: orgId,
		name: orgName,
		selected_at: new Date().toISOString(),
	};
	fs.writeFileSync(ORG_FILE, JSON.stringify(orgData, null, 2));
}

export function getSelectedOrg(): OrgData | undefined {
	try {
		if (fs.existsSync(ORG_FILE)) {
			const data = fs.readFileSync(ORG_FILE, "utf8");
			return JSON.parse(data) as OrgData;
		}
		return undefined;
	} catch (error) {
		console.error("Error reading org file:", error);
		return undefined;
	}
}

function isTokenExpired(tokenData: TokenData): boolean {
	// API keys don't expire
	if (tokenData.keyType === "apikey") {
		return false;
	}

	const tokenDate = new Date(tokenData.created_at);
	const now = new Date();
	const diffInMinutes = (now.getTime() - tokenDate.getTime()) / (1000 * 60);
	return diffInMinutes > 55;
}

// Function to refresh the token
export async function refreshToken(): Promise<TokenData | null> {
	const storedTokens = getStoredTokens();

	if (!storedTokens) {
		console.log("No stored tokens found. Please login first.");
		return null;
	}

	if (!isTokenExpired(storedTokens)) {
		return storedTokens;
	}

	try {
		const { data, error } = await supabase.auth.refreshSession({
			refresh_token: storedTokens.refresh_token as string,
		});

		if (error) {
			console.error("Error refreshing token:", error);
			return null;
		}

		if (!data.session) {
			console.error("No session returned when refreshing token");
			return null;
		}

		const newTokens: TokenData = {
			access_token: data.session.access_token,
			refresh_token: data.session.refresh_token,
			created_at: new Date().toISOString(),
			keyType: "oauth",
		};

		storeTokens(newTokens.access_token, newTokens.refresh_token, "oauth");
		return newTokens;
	} catch (error) {
		console.error("Error refreshing token:", error);
		return null;
	}
}

export async function getValidTokens(): Promise<TokenData | null> {
	const envApiKey = process.env[ORBITER_API_KEY];
	if (envApiKey) {
		return {
			access_token: envApiKey,
			created_at: new Date().toISOString(),
			keyType: "apikey",
		};
	}

	const storedTokens = getStoredTokens();

	if (!storedTokens) {
		console.log(
			"No stored tokens found. Please login or authenticate with an API key.",
		);
		return null;
	}

	// If it's an API key, just return it
	if (storedTokens.keyType === "apikey") {
		return storedTokens;
	}

	// Otherwise handle OAuth token refresh
	if (isTokenExpired(storedTokens)) {
		return await refreshToken();
	}

	return storedTokens;
}

// Add function to store tokens
function storeTokens(
	accessToken: string,
	refreshToken?: string,
	keyType: "oauth" | "apikey" = "oauth",
) {
	const tokens: TokenData = {
		access_token: accessToken,
		refresh_token: refreshToken,
		created_at: new Date().toISOString(),
		keyType,
	};

	fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// Add function to get stored tokens
function getStoredTokens(): TokenData | undefined {
	try {
		if (fs.existsSync(TOKEN_FILE)) {
			const data = fs.readFileSync(TOKEN_FILE, "utf8");
			return JSON.parse(data) as TokenData;
		}
		return undefined;
	} catch (error) {
		console.error("Error reading token file:", error);
		return undefined;
	}
}

export async function login(provider: Provider) {
	try {
		const app = express();
		let serverHandle: any;

		// Serve an HTML page that will parse the hash and send it to the server
		app.get("/", (_req: Request, res: Response) => {
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
			spinner = ora("Logging in...").start();
		});

		// Handle the callback with the hash parameters
		app.get("/callback", async (req: Request, res: Response) => {
			try {
				const accessToken = req.query.access_token as string;
				const refreshToken = req.query.refresh_token as string;

				if (!accessToken) {
					console.error("No access token found");
					res.status(400).send("No access token found");
					return;
				}

				// Set the session
				const { error } = await supabase.auth.setSession({
					access_token: accessToken,
					refresh_token: refreshToken,
				});

				if (error) {
					console.error("Error setting session:", error);
					res.status(400).send("Error setting session");
					return;
				}

				storeTokens(accessToken, refreshToken, "oauth");

				spinner.stopAndPersist({
					text: `Login Successful!`,
				});

				res.status(200).send("Success");

				// Close the server after successful login
				setTimeout(() => {
					serverHandle.close();
					process.exit(0);
				}, 1000);
			} catch (error) {
				console.error("Error in callback:", error);
				res.status(500).send("Internal server error");
			}
		});

		// Start the OAuth flow
		const {
			data: { url },
		} = await supabase.auth.signInWithOAuth({
			provider: provider,
			options: {
				redirectTo: "http://localhost:54321",
			},
		});

		// Open the browser
		await open(url as string);

		// Add a timeout
		setTimeout(() => {
			serverHandle.close();
			console.log("Authentication timed out. Please try again.");
			process.exit(1);
		}, 60000); // 1 minute timeout
	} catch (error) {
		console.error("Error during login:", error);
		process.exit(1);
	}
}
