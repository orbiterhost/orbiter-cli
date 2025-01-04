import { getValidTokens, supabase } from "./auth";

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


export async function createSite(cid: string, subdomain: string) {
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

    const memberships: any = await getOrgMemebershipsForUser()

    const createReq = await fetch(`https://api.orbiter.host/sites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbiter-Token": tokens.access_token,
      },
      body: JSON.stringify({
        orgId: memberships[0].organizations.id,
        cid: cid,
        subdomain: subdomain,
      }),
    });
    const result = await createReq.json()
    console.log(result)
    return result
  } catch (error) {
    console.log(error)
  }
}
