/**
 * Keep the MDX component registry identical for on-site article rendering and
 * server-side RSS rendering, so the feed never loses custom components.
 */
import Callout from '../components/mdx/Callout.astro';
import KeyPoints from '../components/mdx/KeyPoints.astro';
import Steps from '../components/mdx/Steps.astro';
import Step from '../components/mdx/Step.astro';
import Details from '../components/mdx/Details.astro';
import Figure from '../components/mdx/Figure.astro';

export const mdxComponents = { Callout, KeyPoints, Steps, Step, Details, Figure };
