import { getValidTokens, supabase } from "./auth";
import { uploadSite } from "./pinata";
import dotenv from "dotenv";
import { API_URL } from "../config"
import ora from "ora";


dotenv.config()

const getOrgMemebershipsForUser = async () => {
  const { data: memberships, error } = await supabase
    .from("members")
    .select(
      `
      *,
      organizations (
        id,
        name,
        created_at
      )
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching memberships:", error);
    return;
  }

  return memberships;
};


export async function createSite(path: string, subdomain: string) {
  try {
    const spinner = ora("Creating site...").start()

    const upload = await uploadSite(path)

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

    const memberships: any = await getOrgMemebershipsForUser()

    const createReq = await fetch(`${API_URL}/sites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: JSON.stringify({
        orgId: memberships[0].organizations.id,
        cid: upload?.IpfsHash,
        subdomain: subdomain,
      }),
    });
    if (!createReq.ok) {
      const result = await createReq.json()
      throw Error("Problem creating site:", result)
    }
    spinner.stopAndPersist({
      text: `Site created: https://${subdomain}.orbiter.website`
    })
    return
  } catch (error) {
    console.log(error)
  }
}

export async function listSites() {
  try {
    const spinner = ora("Fetching sites...").start()

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

    const memberships: any = await getOrgMemebershipsForUser()
    const orgId = memberships[0].organizations.id
    const siteReq = await fetch(`${API_URL}/organizations/${orgId}/sites`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
    });
    const result = await siteReq.json()
    spinner.stop()
    console.log(result)
    return result

  } catch (error) {
    console.log(error)
  }
}


export async function updateSite(siteId: string, path: string) {
  try {
    const spinner = ora("Updating site...").start()
    const upload = await uploadSite(path)
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

    const updateReq = await fetch(`${API_URL}/sites/${siteId}`, {
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
      throw Error("Problem updating site: ", updateRes)
    }

    spinner.stopAndPersist({
      text: `Site updated`
    })

    return
  } catch (error) {
    console.log(error)
  }
}

export async function deleteSite(siteId: string) {
  try {
    const spinner = ora("Deleting site...").start()
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

    const deleteReq = await fetch(`${API_URL}/sites/${siteId}`, {
      method: "DELETE",
      //	@ts-ignore
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: "",
    });
    if (!deleteReq.ok) {
      const deleteRes = await deleteReq.json()
      throw Error("Problem updating site: ", deleteRes)
    }

    spinner.stopAndPersist({
      text: `Site deleted`
    })

    return
  } catch (error) {
    console.log(error)
  }
}
