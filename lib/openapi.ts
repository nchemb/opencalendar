/** Hand-written OpenAPI 3.1 document for the v1 REST API. Served at /api/v1/openapi.json. */
import { appUrl } from "./env";

const bookingSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: { type: "string", enum: ["PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "CANCELLED", "FAILED_NEEDS_INTERVENTION"] },
    startTime: { type: "string", format: "date-time" },
    endTime: { type: "string", format: "date-time" },
    timezone: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    meetLink: { type: ["string", "null"] },
    manageToken: { type: ["string", "null"] },
    location: {},
    guests: { type: "array", items: { type: "string" } },
    amountCents: { type: ["integer", "null"] },
    paymentStatus: { type: ["string", "null"] },
    calendarPending: { type: "boolean" },
  },
};

const errorSchema = {
  type: "object",
  properties: { ok: { const: false }, error: { type: "string" }, code: { type: "string" } },
  required: ["ok", "error"],
};

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: errorSchema } } };
}

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "BookKit API",
      version: "1",
      description:
        "Self-hosted booking API. List event types, check availability, and create, look up, " +
        "cancel or reschedule bookings. Authenticate with a BookKit API key.",
    },
    servers: [{ url: `${appUrl()}/api/v1` }],
    security: [{ ApiKey: [] }],
    components: {
      securitySchemes: {
        ApiKey: { type: "http", scheme: "bearer", bearerFormat: "bk_live_...", description: "Authorization: Bearer bk_live_..." },
      },
      schemas: { Booking: bookingSchema, Error: errorSchema },
    },
    paths: {
      "/event-types": {
        get: {
          summary: "List active event types",
          description: "Every active event type for this host, including secret (unlisted) ones.",
          operationId: "listEventTypes",
          responses: {
            "200": {
              description: "Event types",
              content: { "application/json": { schema: { type: "object", properties: { ok: { const: true }, data: { type: "object" } } } } },
            },
            "401": errorResponse("Missing or invalid API key"),
          },
        },
      },
      "/event-types/{slug}/availability": {
        get: {
          summary: "Get open slots for an event type",
          operationId: "getAvailability",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "from", in: "query", required: true, schema: { type: "string", format: "date" }, description: "yyyy-MM-dd, in `tz`" },
            { name: "to", in: "query", required: true, schema: { type: "string", format: "date" } },
            { name: "tz", in: "query", schema: { type: "string" }, description: "IANA timezone; defaults to the schedule's timezone" },
            { name: "duration", in: "query", schema: { type: "integer" }, description: "Minutes, for event types with multiple durations" },
          ],
          responses: {
            "200": { description: "Open slots (UTC ISO instants)" },
            "404": errorResponse("Event type not found"),
          },
        },
      },
      "/bookings": {
        get: {
          summary: "List bookings",
          operationId: "listBookings",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "email", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Bookings, newest start time first, cursor-paginated" } },
        },
        post: {
          summary: "Create a booking",
          description: "Free event types only. Paid types return 402 with the booking page URL — the invitee must pay there.",
          operationId: "createBooking",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["slug", "name", "email", "timezone", "startTime"],
                  properties: {
                    slug: { type: "string" },
                    name: { type: "string" },
                    email: { type: "string", format: "email" },
                    timezone: { type: "string", description: "IANA timezone" },
                    startTime: { type: "string", format: "date-time", description: "UTC ISO instant, whole minute" },
                    durationMinutes: { type: "integer" },
                    guests: { type: "array", items: { type: "string", format: "email" } },
                    answers: {},
                    location: { type: "object" },
                    utm: { type: "object" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Booking created", content: { "application/json": { schema: { type: "object", properties: { ok: { const: true }, data: { type: "object", properties: { booking: bookingSchema } } } } } } },
            "400": errorResponse("Invalid input"),
            "402": errorResponse("This event type requires payment — response includes `bookingUrl`"),
            "404": errorResponse("Event type not found"),
            "409": errorResponse("That slot was just taken"),
          },
        },
      },
      "/bookings/{id}": {
        get: {
          summary: "Get a booking",
          operationId: "getBooking",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Booking" }, "404": errorResponse("Not found") },
        },
      },
      "/bookings/{id}/cancel": {
        post: {
          summary: "Cancel a booking",
          description: "Acts as the host: no invitee cutoff applies. Refunds a paid booking by default.",
          operationId: "cancelBooking",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "object", properties: { reason: { type: "string" }, notify: { type: "boolean", default: true }, refund: { type: "boolean", default: true } } },
              },
            },
          },
          responses: { "200": { description: "Cancelled" }, "404": errorResponse("Not found") },
        },
      },
      "/bookings/{id}/reschedule": {
        post: {
          summary: "Reschedule a booking",
          description: "Acts as the host: may move to any slot that is actually free, ignoring the invitee cutoff.",
          operationId: "rescheduleBooking",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", required: ["startTime"], properties: { startTime: { type: "string", format: "date-time" }, reason: { type: "string" } } },
              },
            },
          },
          responses: { "200": { description: "Rescheduled" }, "404": errorResponse("Not found"), "409": errorResponse("That slot was just taken") },
        },
      },
    },
  };
}
