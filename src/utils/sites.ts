import { getValidTokens, supabase } from "./auth";
import { uploadSite } from "./pinata";
import dotenv from "dotenv";
import { API_URL } from "../config"
import ora from "ora";
import { getSelectedOrg } from './auth';

dotenv.config()

export async function createSite(path: string, subdomain: string) {
  const spinner = ora("Creating site...").start()
  try {

    const upload = await uploadSite(path)

    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      spinner.stop()
      return;
    }

    await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      console.log('No active session found');
      spinner.stop()
      return;
    }

    const selectedOrg = getSelectedOrg();
    if (!selectedOrg) {
      console.log('No organization selected. Please run "orbiter org" first');
      spinner.stop();
      return;
    }

    const createReq = await fetch(`${API_URL}/sites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: JSON.stringify({
        orgId: selectedOrg.id,
        cid: upload?.IpfsHash,
        subdomain: subdomain,
      }),
    });
    if (!createReq.ok) {
      const result = await createReq.json()
      spinner.stop()
      console.error("Problem creating site:", result)
      return
    }
    spinner.stopAndPersist({
      text: `Site created: https://${subdomain}.orbiter.website`
    })
    return
  } catch (error) {
    spinner.stop()
    console.log(error)
  }
}

export async function listSites(domain?: string) {
  const spinner = ora("Fetching sites...").start()
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

    const selectedOrg = getSelectedOrg();
    if (!selectedOrg) {
      console.log('No organization selected. Please run "orbiter org" first');
      spinner.stop();
      return;
    }

    if (domain) {
      const siteReq = await fetch(`${API_URL}/organizations/${selectedOrg.id}/sites?domain=${domain}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Orbiter-Token": tokens.access_token,
        },
      });
      const result = await siteReq.json()
      if (!siteReq.ok) {
        spinner.stop()
        console.error("Problem fetching sites: ", result)
        return
      }
      spinner.stop()
      console.log(result)
      return result
    }

    const siteReq = await fetch(`${API_URL}/organizations/${selectedOrg.id}/sites`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
    });
    const result = await siteReq.json()
    if (!siteReq.ok) {
      spinner.stop()
      console.error("Problem fetching sites: ", result)
      return
    }
    spinner.stop()
    console.log(result)
    return result

  } catch (error) {
    spinner.stop()
    console.log(error)
  }
}


export async function updateSite(path: string, siteId?: string, domain?: string) {
  const spinner = ora("Updating site...").start()
  try {
    let id: string | undefined = siteId
    const upload = await uploadSite(path)
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      spinner.stop()
      return;
    }

    await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      console.log('No active session found');
      spinner.stop()
      return;
    }

    const selectedOrg = getSelectedOrg();
    if (!selectedOrg) {
      console.log('No organization selected. Please run "orbiter org" first');
      spinner.stop();
      return;
    }

    if (domain) {
      const siteReq = await fetch(`${API_URL}/organizations/${selectedOrg.id}/sites?domain=${domain}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Orbiter-Token": tokens.access_token,
        },
      });
      const result = await siteReq.json()
      id = result.data[0].id
    }

    const updateReq = await fetch(`${API_URL}/sites/${id}`, {
      method: "PUT",
      //  @ts-ignore
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: JSON.stringify({
        cid: upload?.IpfsHash,
      }),
    });
    if (!updateReq.ok) {
      const updateRes = await updateReq.json()
      spinner.stop()
      console.error("Problem updating site: ", updateRes)
      return
    }

    spinner.stopAndPersist({
      text: `Site updated`
    })

    return
  } catch (error) {
    spinner.stop()
    console.log(error)
  }
}

export async function deleteSite(siteId: string) {
  const spinner = ora("Deleting site...").start()
  try {
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      spinner.stop()
      return;
    }

    await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      console.log('No active session found');
      spinner.stop()
      return;
    }

    const deleteReq = await fetch(`${API_URL}/sites/${siteId}`, {
      method: "DELETE",
      //	@ts-ignore
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
    });
    if (!deleteReq.ok) {
      const deleteRes = await deleteReq.json()
      spinner.stop()
      console.error("Problem updating site: ", deleteRes)
      return
    }

    spinner.stopAndPersist({
      text: `Site deleted`
    })

    return
  } catch (error) {
    spinner.stop()
    console.log(error)
    return
  }
}

export async function listVersions(domain: string) {
  const spinner = ora("Fetching versions...").start()
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
    const siteReq = await fetch(`${API_URL}/sites/${domain}.orbiter.website/versions`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
    });
    const result = await siteReq.json()
    if (!siteReq.ok) {
      spinner.stop()
      console.error("Problem fetching versions: ", result)
      return
    }
    spinner.stop()
    console.log(result)
    return result

  } catch (error) {
    spinner.stop()
    console.log(error)
  }
}

export async function rollbackSite(domain: string, cid: string) {
  const spinner = ora("Rolling back site...").start()
  try {
    const tokens = await getValidTokens();
    if (!tokens) {
      console.log('Please login first');
      spinner.stop()
      return;
    }

    await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      console.log('No active session found');
      spinner.stop()
      return;
    }

    const selectedOrg = getSelectedOrg();
    if (!selectedOrg) {
      console.log('No organization selected. Please run "orbiter org" first');
      spinner.stop();
      return;
    }

    const siteReq = await fetch(`${API_URL}/organizations/${selectedOrg.id}/sites?domain=${domain}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
    });
    const result = await siteReq.json()
    const id = result.data[0].id

    const updateReq = await fetch(`${API_URL}/sites/${id}`, {
      method: "PUT",
      //  @ts-ignore
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: JSON.stringify({
        cid: cid,
      }),
    });
    if (!updateReq.ok) {
      const updateRes = await updateReq.json()
      spinner.stop()
      console.error("Problem rolling back site: ", updateRes)
      return
    }

    spinner.stopAndPersist({
      text: `Rollback Complete`
    })

    return
  } catch (error) {
    spinner.stop()
    console.log(error)
  }
}
