import { CourseSearch } from './course-search/CourseSearch';
import {
  createHttpSearchClient,
  type SearchClient,
} from './course-search/client';

const defaultClient = createHttpSearchClient();

export default function App({
  client = defaultClient,
}: {
  client?: SearchClient;
}) {
  return (
    <main className="app">
      <h1>Course tree search</h1>
      <CourseSearch client={client} />
    </main>
  );
}
