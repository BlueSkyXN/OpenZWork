
describe("desktop telemetry fetch", () => {
  it("delegates telemetry requests to Electron net.fetch", async () => {
    const response = new Response("ok", { status: 200 });


    expect(result).toBe(response);
  });
});
