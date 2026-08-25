---
title: "MemQ — destylacja domeny (Ubiquitous Language, subdomeny, agregaty, rozjazdy model↔kod)"
created: 2026-08-25
type: domain-distillation
---

# MemQ — destylacja domeny

> Produkt tego dokumentu to MAPA domeny, nie kod. Wszystkie nazwy bytów, reguł
> i ścieżek zostały odkryte z dokumentów źródłowych i kodu; każdy wpis ma cytat
> `plik:linia`.

## Krok 0 — Kontekst projektu (odkrycie)

### Źródła, które istnieją

| Dokument | Ścieżka | Rola w destylacji |
|---|---|---|
| PRD (v1, `status: draft`) | `context/foundation/prd.md` | główne źródło wizji, FR-001…FR-015, NFR, Business Logic, Access Control, Non-Goals |
| Notatki kształtowania | `context/foundation/shape-notes.md` | wcześniejsza wersja tych samych FR + zapis rozstrzygnięć („Socrates”) |
| Roadmapa (`status: active`) | `context/foundation/roadmap.md` | narracja/historia zmian: F-01, S-01, S-02 `done`; S-03, S-04 `ready` |
| Notatki pierwotne (PL) | `idea-notes.md` | najwcześniejsze sformułowanie problemu i kryteriów sukcesu |
| Lekcje | `context/foundation/lessons.md` | jedna reguła inżynierska (Promise.all), nie domenowa |
| README / AGENTS.md | `README.md`, `AGENTS.md` | stack, komendy, twarde reguły repo |

Dokumenty wymagań ISTNIEJĄ — destylacja opiera się na nich, kod służy jako
weryfikacja. `context/archive/` jest immutable i nie był modyfikowany.

### Stack i warstwy (gdzie żyje logika biznesowa)

Astro 6 + React 19 + TypeScript strict + Tailwind v4 + Supabase (Postgres + Auth)
+ Cloudflare Workers (`README.md:7-13`, `AGENTS.md:3`).

| Warstwa | Katalog / plik | Co realnie zawiera |
|---|---|---|
| UI (wyspa React) | `src/components/app/PracticeSession.tsx` | **cała reguła walidacji ruchu** — reduktor `INPUT_MOVE` (`:146-175`), tokenizacja (`:216-218`), składanie tokenu z modyfikatorów (`:291-296`) |
| UI (Astro, SSR) | `src/pages/dashboard.astro`, `src/pages/sets/[id].astro`, `src/pages/sets/[id]/[algoId].astro` | zapytania do Supabase inline w frontmatterze, brak warstwy repozytorium |
| API | `src/pages/api/practice/complete.ts` | auth-guard + walidacja **kształtu** JSON (`:24-35`), delegacja do `completePractice` |
| „Domena” (jedyny wydzielony moduł) | `src/lib/practice/streak.ts`, `src/lib/practice/completePractice.ts` | reguła serii czystych przebiegów (`streak.ts:22-25`) i sekwencja insert→read→compute→upsert (`completePractice.ts:52-98`) |
| Persystencja + reguły w DB | `supabase/migrations/20260527000000_domain_schema_rls.sql` | 4 tabele, CHECK własności listy (`:12-16`), UNIQUE `(user_id, algorithm_id)` (`:51`), 13 polityk RLS (`:61-151`) |
| Middleware / dostęp | `src/middleware.ts:4` | `PROTECTED_ROUTES = ["/dashboard", "/sets"]` |
| Treść (seed) | `supabase/algos_seed.sql`, `supabase/seed.sql`, `supabase/fixes/2026-08-24-rotation-notation.sql` | pre-built F2L / OLL / PLL; jednorazowa naprawa notacji |

Wniosek warstwowy: **nie ma warstwy domenowej w rozumieniu DDD**. Jedyne dwa
pliki poza UI/API z regułą biznesową to `src/lib/practice/*`. Reguła rdzeniowa
(poprawność ruchu) mieszka w komponencie React, obok layoutu siatki przycisków
(`PracticeSession.tsx:54-99` to dane układu UI w tym samym pliku co reduktor).

## Krok 1 — Ubiquitous Language

Pojęcia odkryte, nie założone. „BRAK w kodzie” = termin istnieje w dokumentach,
nie ma odpowiednika w kodzie.

| Termin (język domeny) | Definicja | Cytat źródłowy | Miejsce w kodzie |
|---|---|---|---|
| **Learner** (uczący się) | jedyna rola; średniozaawansowany kubiarz budujący repertuar algorytmów | `prd.md:26`, „One flat role: learner” `prd.md:125` | brak własnej encji — tożsamość to `auth.users`; `user_id` w `migrations/…:8,34,46`; `context.locals.user` w `api/practice/complete.ts:6` |
| **Algorithm Set / List** (zestaw, lista algorytmów) | nazwana kolekcja algorytmów; pre-built (systemowa) albo własna użytkownika | FR-003 `prd.md:65`, FR-004 `prd.md:68` | tabela `algorithm_lists` `migrations/…:6-17`; typy `src/db/database.types.ts:17-40`; odczyt `dashboard.astro:15-19` |
| **Pre-built set / is_system** | zestaw dostarczony z aplikacją, bez właściciela | „pre-built algorithm sets included with the app” `prd.md:65` | `is_system boolean` + CHECK `migrations/…:9,12-16`; filtr `.eq("is_system", true)` `dashboard.astro:18` |
| **Algorithm** | nazwa + sekwencja ruchów + pozycja w liście | FR-005 „name + move sequence” `prd.md:71`, FR-007 `prd.md:78` | `algorithms` `migrations/…:20-27`; render `AlgorithmRow.astro:12-19` |
| **Move sequence / moves** | tekstowa sekwencja notacji Singmastera, np. `R U R' U'` | „move sequence” `prd.md:71`, `prd.md:117` | kolumna `moves text` `migrations/…:24`; prop `moves` `PracticeSession.tsx:213` |
| **Move token** | pojedynczy ruch wydzielony z sekwencji, porównywany 1:1 | „Each button press or keypress submits a single move token” `prd.md:117` | `parseMoves()` `PracticeSession.tsx:216-218`; zbiór wytwarzalny `src/test/tokenGrammar.ts:27-30` |
| **Producible token** (token wytwarzalny) | token, który aplikacja w ogóle potrafi wygenerować z klawiatury/siatki | brak w dokumentach — **pojęcie powstałe w kodzie** po incydencie | `tokenGrammar.ts:9-30`; incydent opisany w `supabase/fixes/2026-08-24-rotation-notation.sql:6-12` |
| **Wide / double modifier** | modyfikator zmieniający token bazowy (`R`→`r`, `R`→`R2`) | FR-009 „button grid OR keyboard shortcuts” `prd.md:85` (sam modyfikator: **BRAK w dokumentach**) | sentinele `PracticeSession.tsx:33-34`; złożenie tokenu `:291-296` |
| **Slot** | jedno puste pole odpowiadające jednemu ruchowi algorytmu | „the learner is shown N blank slots (one per move)” `prd.md:117` | `slotResults: SlotResult[]` `PracticeSession.tsx:103,112`; render `:415-432` |
| **Practice Session** (sesja ćwiczenia) | pojedyncze podejście do odtworzenia algorytmu z pamięci od początku do końca | US-01 `prd.md:43-47`, FR-008 `prd.md:82` | stan maszyny `Phase` `PracticeSession.tsx:102`; wiersz `practice_sessions` `migrations/…:32-39` |
| **Clean run** (przebieg czysty) | ukończona sekwencja z zerem błędów | „green if zero errors occurred” `prd.md:119` | `is_clean` `migrations/…:36`; `isClean: errorCount === 0` `PracticeSession.tsx:327` |
| **Error count** | liczba błędnych prób w danym podejściu | „yellow if any error occurred” `prd.md:119` | `errorCount` `PracticeSession.tsx:171`; `error_count` `migrations/…:37` |
| **Forced correction** (wymuszona poprawa) | brak możliwości przejścia dalej bez poprawnego ruchu; brak skip i podpowiedzi | „no skipping, no hints” `prd.md:117`; AC `prd.md:51` | gałąź błędna nie zmienia `currentIndex` `PracticeSession.tsx:166-174` |
| **Consecutive clean / streak** | licznik kolejnych czystych przebiegów **na algorytm** | FR-013 „3 consecutive mistake-free sessions for the same algorithm” `prd.md:98` | `computeStreak()` `streak.ts:22-25`; `consecutive_clean` `migrations/…:48` |
| **Mastery / „You're PRO!”** | stan opanowania algorytmu osiągany przy 3 czystych z rzędu | FR-013 `prd.md:98`, „the mastery state triggers” `prd.md:119` | `mastery_reached` `migrations/…:49`; `newMasteryReached` `streak.ts:24`; baner `PracticeSession.tsx:376-379` |
| **Repeat or Exit** | rozgałęzienie po sesji z błędami | FR-012 `prd.md:94` | **BRAK w kodzie** — po ukończeniu jest tylko „Try Again” `PracticeSession.tsx:490-499`; brak akcji „Exit” |
| **Duplicate detection** | wykrycie identycznej sekwencji przy dodawaniu algorytmu i zaproponowanie istniejącego | FR-015 `prd.md:105`, `prd.md:121` | **BRAK w kodzie** — istnieje wyłącznie indeks przygotowany pod tę regułę `migrations/…:28-29` |
| **Total sessions completed** | globalny licznik ukończonych sesji użytkownika | FR-014 `prd.md:101` | **BRAK w kodzie** — `practice_sessions` nigdzie nie jest odczytywane przez UI (grep: tylko testy i `completePractice.ts:53`) |
| **Custom list / własna lista** | lista tworzona przez użytkownika | FR-004 `prd.md:68`, kryterium sukcesu `prd.md:34` | schemat + RLS gotowe (`migrations/…:65-76`), **BRAK ścieżki tworzenia** — `dashboard.astro:18` pokazuje wyłącznie `is_system = true` |
| **Data isolation** | dane jednego uczącego się nigdy nie są czytelne dla innego | NFR `prd.md:111` | RLS na 4 tabelach `migrations/…:55-58` + 13 polityk `:61-151` |

## Krok 2 — Klasyfikacja subdomen

Kryterium rdzenia: co realizuje kryterium sukcesu `prd.md:31` („≥ 5 algorytmów
odtworzonych z pamięci bez błędu”) i gwarancję `prd.md:37` („walidacja nigdy nie
akceptuje po cichu błędnego ruchu”).

| Obszar / pojęcie | Kategoria | Uzasadnienie (z odwołaniem do celów produktu) |
|---|---|---|
| **Recall Validation** — porównanie tokenu z oczekiwanym, wymuszona poprawa, brak skip | **Core** | To jest cała przewaga produktu: „No focused product exists for the memorization training phase” `prd.md:22`; gwarancja `prd.md:37`; north star roadmapy S-02 `roadmap.md:24` |
| **Mastery / Streak** — 3 czyste z rzędu, sticky mastery | **Core** | Definiuje moment „umiem z pamięci”, czyli sens produktu; FR-013 `prd.md:98`, „the mastery state triggers” `prd.md:119` |
| **Move Notation (grammar tokenów)** — co jest legalnym i wytwarzalnym ruchem | **Core** | Bez wspólnej gramatyki token↔wejście pętla rdzeniowa się zacina — udokumentowany incydent produkcyjny `supabase/fixes/2026-08-24-rotation-notation.sql:6-12`; Non-Goal „no 3D visualization” `prd.md:129` czyni notację JEDYNĄ reprezentacją domeny |
| **Duplicate Detection (FR-015)** | **Core-adjacent → Supporting** | Reguła własna produktu (nie kupisz jej z półki), ale służy jakości treści, nie samej pętli recall; wywodzi się z FR-005 jako środek zaradczy `prd.md:72,105` |
| **Algorithm Catalog** — listy, algorytmy, kolejność, pre-built vs własne | **Supporting** | Konieczny nośnik treści („empty-state on day one kills activation” `prd.md:66`), ale to zwykły CRUD kolekcji — nie tu leży przewaga |
| **Progress Tracking (FR-014)** — globalny licznik sesji | **Supporting** | Musi być (gwarancja trwałości `prd.md:38`), lecz świadomie zdegradowany do jednej liczby; per-algorytm wypchnięty poza MVP `prd.md:133` |
| **Identity & Access (auth, sesje, RLS)** | **Generic** | Email+hasło, jedna płaska rola `prd.md:125`; dostarczone przez Supabase Auth + RLS; brak admina/instruktora — nic specyficznego dla domeny |
| **Presentation / grid layout, hotkeys, style** | **Generic** | Wejście przez siatkę i klawiaturę to wymaganie UX `prd.md:85`, ale sam układ (`PracticeSession.tsx:54-99`) nie niesie reguły domenowej |
| **Sharing, punkty, leaderboard, 3D, mobile, offline** | **poza domeną (Non-Goals)** | `prd.md:129-133` |

## Krok 3 — Kandydaci na agregaty i ich niezmienniki

Legenda statusu: **egzekwuje** = kod uniemożliwia złamanie; **deklaruje** =
reguła jest zapisana/otestowana, ale można ją obejść inną ścieżką; **ignoruje**
= brak jakiegokolwiek mechanizmu.

### A. `PracticeAttempt` (podejście do algorytmu) — kandydat na agregat rdzeniowy

Korzeń: pojedyncza sesja dla `(learner, algorithm)`. Dziś nie istnieje jako byt
— jest rozmyty pomiędzy `State` reduktora a wierszem `practice_sessions`.

| # | Niezmiennik | Cytat źródłowy | Status |
|---|---|---|---|
| A1 | Żaden błędny ruch nie jest po cichu przyjęty jako poprawny | `prd.md:37`, `prd.md:50` | **egzekwuje (tylko klient)** — `PracticeSession.tsx:148-151,166-174`, testy `PracticeSession.reducer.test.ts:33,42` |
| A2 | Pozycja nie może się przesunąć bez poprawnego ruchu (brak skip, brak podpowiedzi) | `prd.md:117`, `prd.md:51` | **egzekwuje (tylko klient)** — `PracticeSession.tsx:166-174` |
| A3 | Sesja jest „ukończona” dopiero, gdy każdy slot został wypełniony poprawnie | `prd.md:51` | **deklaruje** — klient: `PracticeSession.tsx:155-160`; serwer przyjmuje dowolne `{isClean, errorCount}` bez związku z algorytmem `api/practice/complete.ts:24-41` |
| A4 | `isClean` ⇔ `errorCount === 0` (stan końcowy jest binarny) | `prd.md:52`, `prd.md:119` | **deklaruje** — klient wylicza to poprawnie `PracticeSession.tsx:327`, test `PracticeSession.reducer.test.ts:65`; API **nie sprawdza** spójności obu pól (`complete.ts:24-35` waliduje wyłącznie typy) |
| A5 | Przerwanie sesji w połowie nie psuje historii ani serii | `prd.md:53` | **egzekwuje** — `STOP` czyści stan lokalnie i nic nie wysyła `PracticeSession.tsx:186-197` |
| A6 | Jedno realne podejście = najwyżej jeden zapisany rekord sesji | implikowane przez FR-014 („total sessions completed”) `prd.md:101` | **ignoruje** — `RETRY` ponawia POST bez klucza idempotencji `PracticeSession.tsx:183-184,318-344`; przy błędzie po udanym INSERT powstaje drugi wiersz (`completePractice.ts:52-58`, brak UNIQUE w `migrations/…:32-39`) |

### B. `AlgorithmMastery` (seria czystych przebiegów per algorytm)

Korzeń: wiersz `(user_id, algorithm_id)` w `algorithm_mastery`. Najbliżej
prawdziwego agregatu w całym kodzie.

| # | Niezmiennik | Cytat źródłowy | Status |
|---|---|---|---|
| B1 | Czysty przebieg zwiększa licznik o 1; każdy nieczysty zeruje go | `prd.md:119` | **egzekwuje** — `streak.ts:23`, testy `streak.test.ts:75-89`, integracyjnie `streak.int.test.ts:59,70` |
| B2 | Mastery zapada przy dokładnie 3 i nigdy się nie cofa (sticky) | FR-013 `prd.md:98` | **egzekwuje** — `streak.ts:24`; test granicy 2/3 `streak.test.ts:84,88` |
| B3 | Seria jest liczona osobno dla każdego algorytmu | FR-013 „for the same algorithm” `prd.md:98` | **egzekwuje** — UNIQUE `(user_id, algorithm_id)` `migrations/…:51`; test izolacji `streak.int.test.ts:80` |
| B4 | Licznik odzwierciedla faktyczną historię sesji | „The result … is recorded against the algorithm and the consecutive-clean count is updated” `prd.md:119` | **ignoruje** — read-modify-write bez atomowości, świadomie zaakceptowane `completePractice.ts:31-44,59-93`; dwa źródła prawdy (`practice_sessions` vs `algorithm_mastery`) nigdy nie są rekoncyliowane |
| B5 | Baner „You're PRO!” pojawia się wyłącznie na 3. czystym przebiegu | FR-013 `prd.md:98`, US-01 `prd.md:47` | **egzekwuje** — `isPro` czyta odpowiedź serwera `PracticeSession.tsx:346`, nie stan lokalny |

### C. `Algorithm` / `MoveSequence` (sekwencja jako byt domenowy)

Korzeń: wiersz `algorithms`; `moves` jest dziś zwykłym `text`.

| # | Niezmiennik | Cytat źródłowy | Status |
|---|---|---|---|
| C1 | Każdy token sekwencji musi być tokenem, który uczący się jest w stanie wprowadzić | brak wprost w PRD; wymuszone przez FR-010 „must input the correct move to advance” `prd.md:88` | **ignoruje w runtime / deklaruje w testach** — brak CHECK w `migrations/…:20-27`, brak walidacji w kodzie; jedyny strażnik to test tekstu plików seed `src/test/seedTokens.test.ts:50-59` przez `tokenGrammar.ts:27-30` |
| C2 | Sekwencja jest niepusta i uporządkowana | „N blank slots (one per move)” `prd.md:117` | **ignoruje** — `parseMoves("")` zwraca `[]` (`PracticeSession.reducer.test.ts:90`), a sesja z 0 slotami nie ma zdefiniowanego zachowania startowego |
| C3 | Nawiasy grupujące są tylko notacją prezentacyjną, nie ruchem | brak w dokumentach — reguła odkryta w kodzie | **egzekwuje** — `parseMoves` usuwa `()` `PracticeSession.tsx:217`, powielone w `MoveSequence.astro:7` (duplikat reguły w dwóch miejscach) |
| C4 | Ta sama sekwencja nie jest zapisywana dwa razy jako osobne algorytmy | FR-015 `prd.md:105` | **ignoruje** — brak UNIQUE i brak kodu; istnieje wyłącznie indeks przygotowany „pod” tę regułę `migrations/…:28-29` |

### D. `AlgorithmList` (własność i widoczność treści)

| # | Niezmiennik | Cytat źródłowy | Status |
|---|---|---|---|
| D1 | Lista systemowa nie ma właściciela; lista użytkownika ma właściciela — trzeciego stanu nie ma | „is_system=true rows are pre-built content (user_id NULL)” `migrations/…:5`; FR-003/FR-004 `prd.md:65,68` | **egzekwuje** — CHECK `migrations/…:12-16` |
| D2 | Uczący się nie może modyfikować treści systemowej | FR-003 (treść „included with the app”) `prd.md:65` | **egzekwuje** — polityki `al_insert/al_update/al_delete` wymagają `is_system = false` `migrations/…:65-76`; analogicznie `alg_*` `migrations/…:89-128` |
| D3 | Dane uczącego się są nieczytelne dla innych na każdej ścieżce dostępu | NFR `prd.md:111` | **egzekwuje** — RLS włączone na 4 tabelach `migrations/…:55-58`, polityki `user_id = auth.uid()` `:131-151` |
| D4 | Algorytm należy do dokładnie jednej listy | schemat + FR-006 `prd.md:74` | **egzekwuje** — `list_id NOT NULL … ON DELETE CASCADE` `migrations/…:22` |

## Krok 4 — Rozjazdy MODEL vs KOD

| # | Dokument mówi | Kod robi | Dowód |
|---|---|---|---|
| R-01 | „slots turn **yellow** on a completed-with-errors attempt”; stan końcowy binarny: all-green albo all-yellow — FR-011 `prd.md:91-92`, AC `prd.md:52` | Slot ma trzy stany: `pending`/`correct`/`wrong`; poprawiony błąd zamienia czerwony na **zielony**, więc każde ukończone podejście kończy się all-green. Żółty istnieje wyłącznie jako kolor banera tekstowego | `PracticeSession.tsx:103` (`SlotResult`), `:152-153`, `:417-431`; baner `:381-392` |
| R-02 | „Learner is offered **Repeat or Exit** after completing a session with at least one mistake” — FR-012 `prd.md:94` | Po ukończeniu jest jeden przycisk „Try Again”, identyczny dla przebiegu czystego i z błędami; brak akcji „Exit” i brak rozgałęzienia | `PracticeSession.tsx:490-499`; brak `Exit` w całym pliku |
| R-03 | Walidacja ruchu nigdy nie przyjmuje błędnego ruchu; sesji nie da się „ukończyć” pomijając ruchy — `prd.md:37,50-51` | Reguła istnieje **tylko w przeglądarce**. Endpoint przyjmuje `{algorithmId, isClean, errorCount}` na słowo klienta: sprawdza wyłącznie typy pól, nie zna sekwencji, nie weryfikuje `isClean` względem `errorCount` | `api/practice/complete.ts:24-41`; `completePractice.ts:50-58` |
| R-04 | „Learner can view total sessions completed (global count)” — FR-014 `prd.md:101`, gwarancja trwałości `prd.md:38` | Sesje są zapisywane, ale **nigdzie nie odczytywane** przez aplikację — brak zapytania zliczającego i brak miejsca w UI (`dashboard.astro` pokazuje wyłącznie kafle zestawów) | zapis `completePractice.ts:53-58`; brak odczytu — `practice_sessions` w `src/` występuje tylko w `completePractice.ts` i testach; `dashboard.astro:15-19,43-48`; roadmapa S-03 `ready` `roadmap.md:35` |
| R-05 | FR-004 / FR-005 / FR-015: własna lista, dodawanie algorytmu, wykrywanie duplikatu — `prd.md:68-72,105`; kryterium sukcesu „≥ 1 własna lista” `prd.md:34` | Schemat i RLS gotowe, ale nie istnieje żadna ścieżka zapisu: dashboard filtruje `is_system = true`, więc listy użytkownika są niewidoczne nawet gdyby powstały | `dashboard.astro:18`; polityki `migrations/…:65-76`; brak endpointu w `src/pages/api/` (są tylko `auth/*` i `practice/complete.ts`); roadmapa S-04 `ready` `roadmap.md:36` |
| R-06 | „Unauthenticated users cannot access any app content — **login wall at root**” — `prd.md:125` | Chronione są tylko `/dashboard` i `/sets`; `/` renderuje publiczną stronę startera („10x Astro Starter”) zamiast bramki logowania | `middleware.ts:4`; `index.astro:1-8`; `Welcome.astro:35-38` |
| R-07 | „the app checks the submitted sequence against **all stored sequences**” — `prd.md:121` | Indeks pod tę regułę istnieje w schemacie, sama reguła nie istnieje; brak też UNIQUE, więc duplikaty mogą powstać także z seedów | `migrations/…:28-29`; ostrzeżenie o duplikacji przy powtórnym seedzie `supabase/algos_seed.sql:4-5` |
| R-08 | Wejście: „button grid **OR** keyboard shortcuts (letters/numbers **assigned to grid buttons**)” — FR-009 `prd.md:85-86` | Obie ścieżki działają, ale przyciski siatki nie pokazują przypisanych klawiszy — mapowanie żyje wyłącznie w tabeli `KEY_TO_MOVE`; ponadto istnieją modyfikatory `w`/`2`, których PRD w ogóle nie opisuje | `PracticeSession.tsx:8-35`, `:249-268` (etykieta = sam ruch), `:291-296` |
| R-09 | Sekwencja algorytmu to dane domenowe o ustalonej notacji — `prd.md:117,129` | `moves` to wolny `text` bez walidacji; incydent `R2'`/`U2'` unieruchamiał sesję (brak błędu, brak awansu) i wymagał ręcznej naprawy danych produkcyjnych poza migracjami | `migrations/…:24`; `supabase/fixes/2026-08-24-rotation-notation.sql:6-12,34-56`; strażnik testowy `src/test/seedTokens.test.ts:6-11` |
| R-10 | Wynik sesji „is recorded against the algorithm and the consecutive-clean count is updated” jako jedna operacja — `prd.md:119` | Trzy niezależne operacje bez transakcji (INSERT sesji ‖ SELECT mastery → UPSERT mastery); świadomie zaakceptowany lost-update, plus możliwy stan pośredni: sesja zapisana, mastery nie | `completePractice.ts:31-44,52-98` |

## Krok 5 — Ranking refaktoru

Ocena: **wartość** = jak bardzo niezmiennik dotyka rdzenia (recall + mastery);
**ryzyko** = jak słabo jest dziś egzekwowany i jak cicho zawodzi.

| Miejsce | Kandydat | Wartość | Ryzyko | Uzasadnienie |
|---|---|---|---|---|
| **#1** | `MoveSequence` jako Value Object nad `Algorithm` (C1, C2, C3; R-09, R-08) | wysoka — notacja jest jedyną reprezentacją domeny (Non-Goal: brak wizualizacji 3D `prd.md:129`) | **najwyższe** — zero egzekwowania w runtime, awaria jest cicha (sesja stoi, brak błędu), incydent już wystąpił na produkcji, a S-04 (`ready`) otworzy wolne wpisywanie notacji przez użytkownika `prd.md:71` | jedna gramatyka tokenów, wspólna dla wejścia (`dispatchMove`), parsowania (`parseMoves`, dziś zduplikowane w `MoveSequence.astro:7`) i zapisu; walidacja przy tworzeniu algorytmu + CHECK/trigger w DB |
| **#2** | `PracticeAttempt` z weryfikacją po stronie serwera (A3, A4, A6; R-03, R-01, R-02) | najwyższa — to dosłownie gwarancja produktu `prd.md:37` | wysokie — reguła istnieje tylko w reduktorze React; API ufa klientowi, więc `practice_sessions` i cała seria opierają się na deklaracji przeglądarki; brak idempotencji przy `RETRY` | przenieść ocenę podejścia do modułu domenowego (serwer zna `moves`, przyjmuje wprowadzoną sekwencję lub podpisany wynik), dodać spójność `isClean ⇔ errorCount === 0` i klucz idempotencji sesji |
| **#3** | `AlgorithmMastery` — atomowość i pojedyncze źródło prawdy (B4; R-10, R-04) | wysoka — mastery to definicja „umiem” `prd.md:98` | średnie — reguła serii jest poprawna i przetestowana; zawodzi tylko przy współbieżności/retry, a `mastery_reached` nigdy się nie cofa | RPC w Postgresie robiące insert+upsert w jednej transakcji; przy okazji domknięcie FR-014 z tego samego źródła (`count` na `practice_sessions`) |
| **#4** | `DuplicateDetection` jako reguła agregatu `AlgorithmList` (C4; R-07) | średnia — Supporting, wywodzona z FR-005 `prd.md:72` | niskie dziś (brak ścieżki zapisu), rośnie wraz z S-04 | domknąć razem z S-04; przy okazji rozstrzygnąć otwarte pytanie o semantykę „exactly matches” `roadmap.md:125` — po normalizacji przez `MoveSequence` z #1 to pytanie staje się trywialne |
| **#5** | `AlgorithmList` / dostęp (D1–D4; R-06) | średnia | najniższe — CHECK + 13 polityk RLS realnie egzekwują własność i izolację | wystarczy domknąć bramkę logowania na `/` (`middleware.ts:4`), reszta jest w porządku |

**#1 do refaktoru: `MoveSequence` jako Value Object.** Nie dlatego, że jest
najbardziej rdzeniowy (najbardziej rdzeniowy jest `PracticeAttempt`), lecz
dlatego, że iloczyn wartości i ryzyka jest tu największy: reguła nie jest
egzekwowana na ŻADNEJ warstwie (DB, API, UI), jej złamanie już raz dotknęło
produkcji i unieruchomiło pętlę rdzeniową bez żadnego sygnału błędu, a najbliższy
zaplanowany slice (S-04, `ready`) daje użytkownikom wolne pole tekstowe na tę
samą sekwencję `prd.md:71`. Dodatkowo #1 jest warunkiem taniego wykonania #2
i #4: serwerowa weryfikacja podejścia i wykrywanie duplikatów potrzebują tej
samej znormalizowanej, walidowanej sekwencji.

## Ograniczenia tej destylacji

- Cytaty pochodzą wyłącznie z plików odczytanych w tej sesji; `context/archive/`
  nie był otwierany ani modyfikowany (reguła repo: katalog immutable).
- Statusy „egzekwuje/deklaruje/ignoruje” opisują kod na `master` w stanie z
  2026-08-25 (S-03 i S-04 jeszcze niezaimplementowane — `roadmap.md:35-36`).
- PRD ma `status: draft` (`prd.md:4`) — rozjazdy R-01…R-10 mogą być równie dobrze
  sygnałem do poprawienia dokumentu, co kodu; ta decyzja należy do właściciela
  produktu.
