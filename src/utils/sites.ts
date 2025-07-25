import { getValidTokens, supabase } from "./auth";
import { uploadSite } from "./pinata";
import dotenv from "dotenv";
import { API_URL } from "../config";
const SOURCE = process.env.SOURCE || "cli";
import ora from "ora";

dotenv.config();

function normalizeDomain(domain: string): {
	subdomain: string;
	fullDomain: string;
} {
	const suffix = ".orbiter.website";
	if (domain.endsWith(suffix)) {
		const subdomain = domain.replace(suffix, "");
		return { subdomain, fullDomain: domain };
	}
	return {
		subdomain: domain,
		fullDomain: `${domain}${suffix}`,
	};
}

export async function createSite(
	path: string,
	domain: string,
	useExistingSpinner?: boolean,
): Promise<boolean> {
	const spinner = useExistingSpinner ? null : ora("Creating site...").start();
	try {
		const { subdomain } = normalizeDomain(domain);

		const uploadResponse = await uploadSite(path);

		if (uploadResponse.error) {
			if (spinner) {
				spinner.fail(`Error: ${uploadResponse.error}`);
			} else {
				console.error(`Error: ${uploadResponse.error}`);
			}
			return false;
		}

		const upload = uploadResponse.data;

		const tokens = await getValidTokens();
		if (!tokens) {
			console.log("Please login first");
			if (spinner) {
				spinner.stop();
			}
			return false;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				if (spinner) {
					spinner.stop();
				}
				return false
			}
		}

		const createReq = await fetch(`${API_URL}/sites`, {
			method: "POST",
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
			body: JSON.stringify({
				cid: upload?.IpfsHash,
				subdomain: subdomain,
			}),
		});
		if (!createReq.ok) {
			const result = await createReq.json();
			if (spinner) {
				spinner.stop();
			}
			if (result.message && result.message.toLowerCase().includes("site limit")) {
				console.log("\n\x1b[31m/////// HOUSTON, WE HAVE A PROBLEM! ///////\x1b[0m");
				console.log("\x1b[31m///////////////////////////////////////////\x1b[0m");
				console.log("\x1b[31m///// YOU'VE HIT YOUR SITE LIMIT! /////////\x1b[0m");
				console.log("\x1b[31m/// UPGRADE TO UNLOCK MORE SITES //////////\x1b[0m");
				console.log("\x1b[31m///////////////////////////////////////////\x1b[0m");
				console.log("\n\x1b[31m🚀 MISSION CONTROL: https://app.orbiter.host/billing\x1b[0m\n");
			} else {
				console.error("Problem creating site:", result);
			}
			return false;
		}
		if (spinner) {
			spinner.succeed(`Site created: https://${subdomain}.orbiter.website`);
		}
		return true;
	} catch (error) {
		if (spinner) {
			spinner.stop();
		}
		console.log(error);
		return false
	}
}

export async function listSites(
	domain?: string,
	verbose?: boolean,
	existingSpinner?: ora.Ora,
) {
	const spinner = existingSpinner || ora("Fetching sites...").start();
	const shouldManageSpinner = !existingSpinner;

	try {
		const tokens = await getValidTokens();
		if (!tokens) {
			if (shouldManageSpinner) spinner.fail("Please login first");
			return;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				spinner.stop();
				return;
			}
		}

		if (domain) {
			const siteReq = await fetch(`${API_URL}/sites?domain=${domain}`, {
				method: "GET",
				headers: {
					Source: `${SOURCE}`,
					"Content-Type": "application/json",
					...(tokens.keyType === "apikey"
						? { "X-Orbiter-API-Key": `${tokens.access_token}` }
						: { "X-Orbiter-Token": tokens.access_token }),
				},
			});
			const result = await siteReq.json();
			if (!siteReq.ok) {
				if (shouldManageSpinner)
					spinner.fail("Problem fetching sites: " + JSON.stringify(result));
				return;
			}
			if (shouldManageSpinner) spinner.stop();
			if (verbose) {
				console.log(result);
			}
			return result;
		}

		const siteReq = await fetch(`${API_URL}/sites`, {
			method: "GET",
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
		});
		const result = await siteReq.json();
		if (!siteReq.ok) {
			spinner.stop();
			console.error("Problem fetching sites: ", result);
			return;
		}
		if (shouldManageSpinner) spinner.stop();
		if (verbose) {
			console.log(result);
		}
		return result;
	} catch (error) {
		spinner.stop();
		console.log(error);
	}
}

export async function updateSite(
	path: string,
	siteId?: string,
	domain?: string,
	useExistingSpinner?: boolean,
) {
	const spinner = useExistingSpinner ? null : ora("Updating site...").start();
	try {
		let id: string | undefined = siteId;
		const uploadResponse = await uploadSite(path);

		if (uploadResponse.error) {
			if (spinner) {
				spinner.fail(`Error: ${uploadResponse.error}`);
			} else {
				console.error(`Error: ${uploadResponse.error}`);
			}
			return;
		}

		const upload = uploadResponse.data;

		const tokens = await getValidTokens();
		if (!tokens) {
			console.log("Please login first");
			if (spinner) {
				spinner.stop();
			}

			return;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				if (spinner) {
					spinner.stop();
				}
				return;
			}
		}

		if (domain) {
			const { subdomain } = normalizeDomain(domain);
			const siteReq = await fetch(`${API_URL}/sites?domain=${subdomain}`, {
				method: "GET",
				headers: {
					Source: `${SOURCE}`,
					"Content-Type": "application/json",
					...(tokens.keyType === "apikey"
						? { "X-Orbiter-API-Key": `${tokens.access_token}` }
						: { "X-Orbiter-Token": tokens.access_token }),
				},
			});
			const result = await siteReq.json();
			id = result.data[0].id;
		}

		const updateReq = await fetch(`${API_URL}/sites/${id}`, {
			method: "PUT",
			//  @ts-ignore
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
			body: JSON.stringify({
				cid: upload?.IpfsHash,
			}),
		});
		if (!updateReq.ok) {
			const updateRes = await updateReq.json();
			if (spinner) {
				spinner.stop();
			}
			console.error("Problem updating site: ", updateRes);
			return;
		}

		if (spinner) {
			spinner.succeed(`Site updated`);
		}

		return;
	} catch (error) {
		if (spinner) {
			spinner.stop();
		}
		console.log(error);
	}
}

export async function deleteSite(siteId: string) {
	const spinner = ora("Deleting site...").start();
	try {
		const tokens = await getValidTokens();
		if (!tokens) {
			console.log("Please login first");
			spinner.stop();
			return;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				spinner.stop();
				return;
			}
		}

		const deleteReq = await fetch(`${API_URL}/sites/${siteId}`, {
			method: "DELETE",
			//	@ts-ignore
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
		});
		if (!deleteReq.ok) {
			const deleteRes = await deleteReq.json();
			spinner.stop();
			console.error("Problem updating site: ", deleteRes);
			return;
		}

		spinner.succeed(`Site deleted`);

		return;
	} catch (error) {
		spinner.stop();
		console.log(error);
		return;
	}
}

export async function listVersions(domain: string) {
	const { fullDomain } = normalizeDomain(domain);

	const spinner = ora("Fetching versions...").start();
	try {
		const tokens = await getValidTokens();
		if (!tokens) {
			console.log("Please login first");
			return;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				return;
			}
		}

		const siteReq = await fetch(`${API_URL}/sites/${fullDomain}/versions`, {
			method: "GET",
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
		});
		const result = await siteReq.json();
		if (!siteReq.ok) {
			spinner.stop();
			console.error("Problem fetching versions: ", result);
			return;
		}
		spinner.stop();
		console.log(result);
		return result;
	} catch (error) {
		spinner.stop();
		console.log(error);
	}
}

export async function rollbackSite(domain: string, cid: string) {
	const spinner = ora("Rolling back site...").start();
	try {
		const tokens = await getValidTokens();
		if (!tokens) {
			console.log("Please login first");
			spinner.stop();
			return;
		}

		if (tokens.keyType === "oauth") {
			await supabase.auth.setSession({
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token as string,
			});

			const {
				data: { session },
				error,
			} = await supabase.auth.getSession();

			if (error || !session) {
				console.log("No active session found");
				spinner.stop();
				return;
			}
		}

		const siteReq = await fetch(`${API_URL}/sites?domain=${domain}`, {
			method: "GET",
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
		});
		const result = await siteReq.json();
		const id = result.data[0].id;

		const updateReq = await fetch(`${API_URL}/sites/${id}`, {
			method: "PUT",
			//  @ts-ignore
			headers: {
				Source: `${SOURCE}`,
				"Content-Type": "application/json",
				...(tokens.keyType === "apikey"
					? { "X-Orbiter-API-Key": `${tokens.access_token}` }
					: { "X-Orbiter-Token": tokens.access_token }),
			},
			body: JSON.stringify({
				cid: cid,
			}),
		});
		if (!updateReq.ok) {
			const updateRes = await updateReq.json();
			spinner.stop();
			console.error("Problem rolling back site: ", updateRes);
			return;
		}

		spinner.succeed(`Rollback Complete`);

		return;
	} catch (error) {
		spinner.stop();
		console.log(error);
	}
}
