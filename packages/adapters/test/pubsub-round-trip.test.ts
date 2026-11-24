import { expect, test } from "bun:test";
import { createMemoryPubSub, type PubSub, probeTopic, pubsubRoundTrip } from "../src/pubsub";

test("a probe that comes back gives its time and leaves no subscriber; one that doesn't gives null", async () => {
  const pubsub = createMemoryPubSub();
  const heard: unknown[] = [];
  const watch = pubsub.subscribe(probeTopic, (event) => heard.push(event));
  expect(await pubsubRoundTrip(pubsub)).toBeGreaterThanOrEqual(0);
  watch();
  expect(heard).toHaveLength(1);

  let subscribed = 0;
  const deaf: PubSub = {
    publish: async () => {},
    subscribe: () => {
      subscribed++;
      return () => subscribed--;
    },
  };
  expect(await pubsubRoundTrip(deaf, 20)).toBeNull();
  expect(subscribed).toBe(0);

  const broken: PubSub = { ...deaf, publish: async () => Promise.reject(new Error("notify failed")) };
  expect(await pubsubRoundTrip(broken, 5_000)).toBeNull();
  expect(subscribed).toBe(0);
});
