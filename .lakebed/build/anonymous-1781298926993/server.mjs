// ../../../.npm/_npx/3eb8d3eaaf4ef1b4/node_modules/lakebed/dist/server.js
function capsule(definition) {
  return definition;
}
function endpoint(route, handler) {
  return {
    handler,
    kind: "endpoint",
    method: String(route?.method ?? "").toUpperCase(),
    path: String(route?.path ?? "")
  };
}
function response(body, { headers = {}, status = 200 } = {}) {
  return {
    body,
    headers,
    kind: "response",
    status
  };
}
function text(value, options = {}) {
  return response(String(value ?? ""), {
    ...options,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...options.headers ?? {}
    }
  });
}

// lakebed-source:server/index.ts
var server_default = capsule({
  name: "antiyoy-remaster",
  schema: {},
  queries: {},
  mutations: {},
  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok"))
  }
});
export {
  server_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vLm5wbS9fbnB4LzNlYjhkM2VhYWY0ZWYxYjQvbm9kZV9tb2R1bGVzL2xha2ViZWQvc3JjL3NlcnZlci50cyIsICJsYWtlYmVkLXNvdXJjZTpzZXJ2ZXIvaW5kZXgudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbbnVsbCwgImltcG9ydCB7IGNhcHN1bGUsIGVuZHBvaW50LCB0ZXh0IH0gZnJvbSBcImxha2ViZWQvc2VydmVyXCI7XG5cbi8vIEFudGl5b3kgUmVtYXN0ZXIgaXMgYSBmdWxseSBjbGllbnQtc2lkZSBnYW1lOyB0aGUgc2VydmVyIG9ubHkgbmFtZXMgdGhlXG4vLyBjYXBzdWxlIGFuZCBleHBvc2VzIGEgaGVhbHRoIGVuZHBvaW50LlxuZXhwb3J0IGRlZmF1bHQgY2Fwc3VsZSh7XG4gIG5hbWU6IFwiYW50aXlveS1yZW1hc3RlclwiLFxuXG4gIHNjaGVtYToge30sXG4gIHF1ZXJpZXM6IHt9LFxuICBtdXRhdGlvbnM6IHt9LFxuXG4gIGVuZHBvaW50czoge1xuICAgIHN0YXR1czogZW5kcG9pbnQoeyBtZXRob2Q6IFwiR0VUXCIsIHBhdGg6IFwiL2FwaS9zdGF0dXNcIiB9LCAoKSA9PiB0ZXh0KFwib2tcIikpLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBNEZNLFNBQVUsUUFBVyxZQUFhO0FBQ3RDLFNBQU87QUFDVDtBQVlNLFNBQVUsU0FDZCxPQUNBLFNBQWlGO0FBRWpGLFNBQU87SUFDTDtJQUNBLE1BQU07SUFDTixRQUFRLE9BQU8sT0FBTyxVQUFVLEVBQUUsRUFBRSxZQUFXO0lBQy9DLE1BQU0sT0FBTyxPQUFPLFFBQVEsRUFBRTs7QUFFbEM7QUFFQSxTQUFTLFNBQVMsTUFBYyxFQUFFLFVBQVUsQ0FBQSxHQUFJLFNBQVMsSUFBRyxJQUE4QixDQUFBLEdBQUU7QUFDMUYsU0FBTztJQUNMO0lBQ0E7SUFDQSxNQUFNO0lBQ047O0FBRUo7QUFZTSxTQUFVLEtBQUssT0FBZ0IsVUFBbUMsQ0FBQSxHQUFFO0FBQ3hFLFNBQU8sU0FBUyxPQUFPLFNBQVMsRUFBRSxHQUFHO0lBQ25DLEdBQUc7SUFDSCxTQUFTO01BQ1AsZ0JBQWdCO01BQ2hCLEdBQUksUUFBUSxXQUFXLENBQUE7O0dBRTFCO0FBQ0g7OztBQzdJQSxJQUFPLGlCQUFRLFFBQVE7QUFBQSxFQUNyQixNQUFNO0FBQUEsRUFFTixRQUFRLENBQUM7QUFBQSxFQUNULFNBQVMsQ0FBQztBQUFBLEVBQ1YsV0FBVyxDQUFDO0FBQUEsRUFFWixXQUFXO0FBQUEsSUFDVCxRQUFRLFNBQVMsRUFBRSxRQUFRLE9BQU8sTUFBTSxjQUFjLEdBQUcsTUFBTSxLQUFLLElBQUksQ0FBQztBQUFBLEVBQzNFO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
