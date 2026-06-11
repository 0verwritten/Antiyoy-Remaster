import { capsule, endpoint, text } from "lakebed/server";

// Antiyoy Remaster is a fully client-side game; the server only names the
// capsule and exposes a health endpoint.
export default capsule({
  name: "antiyoy-remaster",

  schema: {},
  queries: {},
  mutations: {},

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok")),
  },
});
