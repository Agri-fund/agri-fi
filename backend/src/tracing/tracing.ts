/**
 * OpenTelemetry tracing bootstrap (#1233).
 *
 * `startTracing()` must run before any instrumented module is imported so the
 * global tracer provider and W3C propagators are installed early. It is invoked
 * from `main.ts` (and from tests that need an in-memory exporter).
 *
 * Manual instrumentation for HTTP (via middleware/interceptor), database queries
 * (via TypeORM hooks), messaging (via queue service), and Stellar calls (via
 * TracingService.traceHorizonCall()).
 */

import {
  DiagConsoleLogger,
  DiagLogLevel,
  context,
  diag,
  propagation,
  trace,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import axios from 'axios';

let provider: TracerProvider | undefined;
let started = false;

function parseResourceAttributes(value?: string): Record<string, string> {
  if (!value) return {};
  return value.split(',').reduce<Record<string, string>>((acc, pair) => {
    const [key, ...rest] = pair.split('=');
    if (key && rest.length) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
}

function buildSampler():
  | ParentBasedSampler
  | AlwaysOnSampler
  | AlwaysOffSampler {
  const name = (process.env.OTEL_TRACES_SAMPLER || '').trim();
  const arg = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? '0.1');

  switch (name) {
    case 'always_on':
      return new AlwaysOnSampler();
    case 'always_off':
      return new AlwaysOffSampler();
    case 'traceidratio':
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(Number.isFinite(arg) ? arg : 0.1),
      });
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(Number.isFinite(arg) ? arg : 0.1),
      });
    default: {
      // Sensible default: sample everything outside production, 10% in prod.
      const ratio =
        process.env.NODE_ENV === 'production'
          ? Number(process.env.OTEL_TRACES_SAMPLE_RATIO ?? '0.1')
          : 1;
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(ratio),
      });
    }
  }
}

/**
 * Injects the active trace context into every outbound axios request as a
 * W3C `traceparent` header, so calls to other services join the same trace.
 */
function instrumentAxios(): void {
  axios.interceptors.request.use((config) => {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    for (const [key, value] of Object.entries(carrier)) {
      config.headers.set(key, value);
    }
    return config;
  });
}

export function startTracing(): TracerProvider | undefined {
  if (started) return provider;
  started = true;

  if (process.env.OTEL_SDK_DISABLED === 'true') {
    diag.info('OpenTelemetry tracing disabled via OTEL_SDK_DISABLED');
    return undefined;
  }

  if (process.env.OTEL_DIAG_LOG_LEVEL) {
    diag.setLogger(
      new DiagConsoleLogger(),
      (process.env.OTEL_DIAG_LOG_LEVEL as unknown as DiagLogLevel) ??
        DiagLogLevel.INFO,
    );
  }

  const resource = resourceFromAttributes({
    'service.name':
      process.env.OTEL_SERVICE_NAME ||
      process.env.npm_package_name ||
      'agri-fi-backend',
    'service.version': process.env.npm_package_version || '0.1.0',
    'deployment.environment':
      process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
      process.env.NODE_ENV ||
      'development',
    ...parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
  });

  const spanProcessors = [];

  const otlpEndpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (otlpEndpoint) {
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        ? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        : `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? parseResourceAttributes(process.env.OTEL_EXPORTER_OTLP_HEADERS)
        : {},
    });
    spanProcessors.push(new BatchSpanProcessor(exporter));
  }

  if (process.env.OTEL_CONSOLE_EXPORT === 'true') {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  provider = new TracerProvider({
    resource,
    sampler: buildSampler(),
    spanProcessors,
  });

  // `TracerProvider` (v2) no longer has `register()` — register the API globals
  // explicitly: async context manager (required for `context.active()` inside
  // async handlers), W3C propagator and the tracer provider itself.
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  );
  trace.setGlobalTracerProvider(provider);

  // Additional axios instrumentation for trace context injection
  instrumentAxios();

  diag.info('OpenTelemetry tracing initialised');
  return provider;
}

export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } finally {
    provider = undefined;
    started = false;
  }
}

/** Test helper — resets module state between specs. */
export function __resetTracingForTests(): void {
  provider = undefined;
  started = false;
}
