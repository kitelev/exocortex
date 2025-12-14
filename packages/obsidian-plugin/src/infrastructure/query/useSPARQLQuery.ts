import { useQuery, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { SolutionMapping, Triple } from "exocortex";
import type { QueryResult } from '@plugin/application/api/SPARQLApi';
import type ExocortexPlugin from '@plugin/ExocortexPlugin';
import { getQueryClient } from "./QueryClientSetup";

export type SPARQLQueryResult = SolutionMapping[] | Triple[];

export interface UseSPARQLQueryOptions {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  refetchOnMount?: boolean | "always";
  refetchOnWindowFocus?: boolean;
}

function generateQueryKey(queryString: string): readonly string[] {
  const normalizedQuery = queryString.trim().replace(/\s+/g, " ");
  return ["sparql", normalizedQuery] as const;
}

export function useSPARQLQuery(
  plugin: ExocortexPlugin,
  queryString: string,
  options: UseSPARQLQueryOptions = {}
): UseQueryResult<QueryResult, Error> {
  const sparqlApi = plugin.getSPARQLApi?.();

  const queryFn = async (): Promise<QueryResult> => {
    if (!sparqlApi) {
      throw new Error("SPARQL API not available");
    }
    return sparqlApi.query(queryString);
  };

  const queryOptions: UseQueryOptions<QueryResult, Error> = {
    queryKey: generateQueryKey(queryString),
    queryFn,
    enabled: options.enabled !== false && !!sparqlApi,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    refetchOnMount: options.refetchOnMount ?? false,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
  };

  return useQuery(queryOptions);
}

export interface UseSPARQLQueryWithTransformOptions<T> extends UseSPARQLQueryOptions {
  transform: (result: QueryResult) => T;
}

export function useSPARQLQueryWithTransform<T>(
  plugin: ExocortexPlugin,
  queryString: string,
  options: UseSPARQLQueryWithTransformOptions<T>
): UseQueryResult<T, Error> {
  const sparqlApi = plugin.getSPARQLApi?.();

  const queryFn = async (): Promise<T> => {
    if (!sparqlApi) {
      throw new Error("SPARQL API not available");
    }
    const result = await sparqlApi.query(queryString);
    return options.transform(result);
  };

  const queryOptions: UseQueryOptions<T, Error> = {
    queryKey: [...generateQueryKey(queryString), "transformed"],
    queryFn,
    enabled: options.enabled !== false && !!sparqlApi,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    refetchOnMount: options.refetchOnMount ?? false,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
  };

  return useQuery(queryOptions);
}

export function prefetchSPARQLQuery(
  plugin: ExocortexPlugin,
  queryString: string
): Promise<void> {
  const sparqlApi = plugin.getSPARQLApi?.();
  if (!sparqlApi) {
    return Promise.resolve();
  }

  const queryClient = getQueryClient();

  return queryClient.prefetchQuery({
    queryKey: generateQueryKey(queryString),
    queryFn: () => sparqlApi.query(queryString),
  });
}
