# Raport architektoniczny — moduł 4 (10xArchitect)

**Data:** 2026-08-25 · **Autor:** pawel.rybczynski@redge.media
**Zakres:** synteza artefaktów L2–L5. Wyłącznie treść artefaktów; twierdzenia
liczbowe pochodzą z nich, nie z pamięci o kodzie.

---

## 1. Opisane projekty

Artefakty powstały na **dwóch różnych repozytoriach**.

| Repo | Stack | Skala (orientacyjnie) | Artefakt |
|---|---|---|---|
| **`openstack/openstack`** (superrepo submodułów) | Python; do tego YAML/Jinja w warstwie deploymentu, JS w `horizon` | 690 gitlinków, 15 278 commitów `Update git submodules`, 428 submodułów ruszyło w roku / **262 martwych**; głęboko przeskanowano 15 repo → 24 260 zmian plików w 3 851 commitach | **L2** — mapa repozytorium |
| **`openstack/openstack` → submoduł `nova`** (HEAD `9aa9a54e04`, shallow, detached) | Python; `oslo`, libvirt-python, os-vif, os-brick | `virt/libvirt/driver.py` 13 990 LOC · `tests/unit/.../test_driver.py` 33 799 LOC · fake libvirt 2 834 LOC · 44 patche w `driver.py` w oknie 12 mies. | **L3** — analiza ficzera; **L4** — plan refaktoryzacji |
| **`memq`** | Astro 6 (`output: server`, adapter Cloudflare) + React 19 islands + TS strict + Tailwind v4 + Supabase (Postgres + Auth) + Cloudflare Workers | 4 tabele + 13 polityk RLS w jednej migracji; 16 plików w `src/` importuje `@supabase/*`; cała reguła walidacji ruchu w jednym komponencie React | **L5** — notatki domenowe / DDD (3 dokumenty) |

Uwaga: L3 i L4 są **wewnątrz** superrepo z L2, ale mierzą tylko submoduł `nova`.
Cross-repo (os-vif, os-brick, tempest, kolla-ansible) wyłączono zakresem — jest
**niezmierzone, nie „niesprzężone”**.

---

## 2. Mapa projektu (L2)

1. **To nie jest baza kodu, to superrepo.** Cała 12-miesięczna historia rootu to
   jeden temat commita. Realny kod jest poziom niżej, a 262 submoduły nie ruszyły
   się ani raz — czytanie ich niczego o systemie nie uczy.
2. **Struktura jest zdrowsza niż churn.** `nova`/`neutron`/`cinder` mają **zero**
   bezpośrednich importów między sobą; najbardziej ruchliwy obszar roku
   (`ovn_client.py`) jest jednocześnie **najtańszy** w zmianie — zero naruszeń
   warstw. Churn ≠ zgnilizna.
3. **Rozmiar domknięcia importów przewiduje koszt mockowania monotonicznie** dla
   każdego zmierzonego pliku. To najużyteczniejsza heurystyka w tym repo: przed
   dotknięciem pliku sprawdź jego closure.
4. **Strefy ryzyka są asymetryczne.** R1 `neutron/.../ovn/mech_driver/ovsdb/` —
   najczęściej zmieniany folder w OpenStacku, **69 % commitów bez zmiany testu
   jednostkowego**. R2 `nova/virt/libvirt/driver.py` — closure 304 plików (49 %
   nova), ~2 136 mock patchy, brak jakiegokolwiek tieru fullstack. R3 deployment
   (kolla-ansible ↔ kayobe) — shotgun surgery, sync między repo to **ręczne
   zadanie per release**, raz już wycofane. R4 stack klienta — strukturalnie
   najtańszy, ale **58,9 % commitów to jedna osoba**; bus factor, nie refaktor.
5. **Najważniejsze unknowns są nazwane wprost.** Warstwa deploymentu — najbardziej
   churnująca z czterech — **nie ma żadnego grafu importów** (kolla-ansible i
   openstack-helm nie są pakietami Python; kayobe: 28 plików w grafie przy 951
   YAML). „Zero cykli” to tam fałszywy negatyw. Brak też danych o review (tylko
   authorship, bez Gerrita) i o warstwie JS/TS.

Punkty wejścia wskazane na pierwszy dzień: `.gitmodules` rootu → `openstacksdk/
openstack/resource.py` (closure 8, co-change 86 % przez 44 katalogi) →
`ovn_client.py` → `libvirt/driver.py` (czytać importy, nie ciało).

---

## 3. Analiza ficzera (L3)

**Przepływ:** boot/spawn instancji — `POST /servers` aż do działającej domeny
libvirt i powrotu `vm_state=ACTIVE`. Wybrany, bo to **dokładnie strefa ryzyka R2**
z mapy (closure 304 plików, brak tieru fullstack). Zakres blast-radius: sam
submoduł `nova`.

**Feature overview.** Input wchodzi HTTP-em przez `servers.py` (14-ogniwowy łańcuch
schematów mikrowersji, polityka sprawdzana *po* schemacie), potem pięć hopów
orkiestracji i **jedno** wejście w hypervisor: `compute/api.py` → cast do
`conductor/manager.py` → **call** (jedyny blokujący hop) do `scheduler/manager.py`
→ cast do `compute/manager.py` → `LibvirtDriver.spawn`. Stan zmienia się w dwóch
miejscach nietrywialnie: alokacja w Placement jest zapisana **przed** powstaniem
wiersza instancji (`scheduler/manager.py:470-477` vs `conductor/manager.py:1740`),
a commit `vm_state=ACTIVE` idzie compare-and-swap przez `expected_task_state`
(`compute/manager.py:2826` → `db/main/api.py:2317-2326`). Klient dostaje `202` z
UUID-em, zanim wiersz istnieje w jakiejkolwiek celi; realny stan czyta się dopiero
`GET /servers/{id}`.

**Technical debt — trzy najważniejsze ryzyka:**

- **D1 — testy weryfikują XML, który Nova buduje, nie domenę, którą libvirt by
  wystartował.** Fake libvirt (`tests/fixtures/libvirt.py`, 2 834 LOC) nie
  waliduje schematu w `defineXML` i **ignoruje flagi** w `createWithFlags`
  (dosłowny `# FIXME: Not handling flags at the moment`, `:1411`) — więc regresja
  paused-boot jest niewidzialna. `XMLDesc` re-syntetyzuje *inny* dokument
  (hardkod `machine='pc-0.12'`), a `<cpu>`, `<memoryBacking>`, `<tpm>`,
  `<launchSecurity>`, `<sysinfo>` nie są **nigdy** ani parsowane, ani emitowane.
  Całe klasy regresji są strukturalnie niewykrywalne w repo. Wspiera to D2:
  `find` na `fullstack|integration|tempest` → **zero** katalogów; sygnał z
  prawdziwego libvirta żyje w jobach devstack/tempest w `.zuul.yaml`, poza drzewem.
- **Kruche sprzężenie na granicy domen — potwierdzone ast-grepem i *korygujące*
  mapę.** Mapa flaguje dwa importy obcych domen w `driver.py:91` (neutron) i
  `:136` (cinder). L3 mierzy je na AST: `_network_api` ma **dokładnie jedno**
  miejsce użycia (`:10821`, w `check_can_live_migrate_destination`) — jest martwy
  dla bootu; ale `_volume_api` ma siedem, i **jedno leży na ścieżce spawn**
  (`_get_guest_storage_config` → `_connect_volume` → `_attach_encryptor` →
  `_get_volume_encryption:2329`). Każdy boot z wolumenowym BDM woła Cinder
  wprost z drivera. Do tego upcall driver → orkiestrator: driver blokuje się na
  szynie zdarzeń managera (`driver.py:8555` → `compute/manager.py:508`) — na
  całym `nova/virt/` istnieją **dwa** takie call-site'y.
- **Blast radius nie idzie importami, idzie szwem i testami** (ast-grep):
  **168** instrukcji importu `nova.virt.libvirt`, z czego produkcyjnych
  importerów **spoza pakietu jest dokładnie 3** (`nova/test.py:71`,
  `cmd/status.py:50`, `cmd/manage.py:89`), a 103 to 54 pliki testowe. Koszt
  siedzi w abstrakcyjnym szwie `ComputeDriver.spawn` — ast-grep znajduje **10**
  definicji `def spawn` w `nova/virt/` (w tym `vmwareapi/vmops.py:738`, którą
  pierwsze przejście pominęło) — oraz w mockach: **2 020** wywołań `mock.patch*`
  / **2 092** primitywów patchujących w `test_driver.py`, **79,3 %** celów
  stringowych wskazuje na własny kod Novy. Jeden patch na ~6,7 linii produkcyjnej.

Osobno: **L3 obalił przeniesienie R1 na R2.** Współczynnik commitów bez testu dla
`nova/virt/libvirt/` to **11,6 %** (8/69), z czego tylko 4 to zmiany zachowania
(5,8 %). Dług R2 to nie brakujące commity testowe — to testy, które nie widzą
hypervisora. Ast-grep skorygował także dwa własne wnioski raportu (fake **ma**
jedną walidację create-time; mechanizm wyłączenia zdarzeń async jest inny niż
opisano — wniosek przeżył, mechanizm nie).

---

## 4. Plan refaktoryzacji (L4)

**Co refaktoryzowane:** Tier 1 z rankingu research §8 — **O1–O7**, siedem
niezależnie poprawnych commitów na lokalnej gałęzi w submodule `nova`, ≈200 LOC w
8 plikach, prawie wyłącznie kod testowy. Docelowy kształt: `self.guest_configs`
dostępne w **każdym** funkcjonalnym teście libvirt (trzy skopiowane bloki
przechwytujące usunięte), noga fatal-timeout `driver.py:8571-8582` ma
**pierwsze w historii** asercje, predykat `pause` staje się mutation-sensitive, a
usunięcie `guest.resume()` albo zmiana emitowanego machine type / boot device
**psuje test** zamiast przechodzić po cichu.

**Czego świadomie NIE robimy:** nie pushujemy na Gerrit (submisja zostaje decyzją
człowieka) i nie zgłaszamy buga na Launchpadzie (Phase 2 pisze tylko draft); nie
tykamy Tier 2/3 — w tym O8, realnego buga produkcyjnego w `migration.py:600,616`
(research jawnie odkłada O11/O12 do czasu wylądowania O1, więc planowanie ich
teraz planowałoby pracę, która zmieni kształt); **nie** zmuszamy fake'a do
round-trippingu `XMLDesc` (wierne echo jest *mniej* wierne niż dzisiejszy fake,
bo prawdziwy libvirt post-processuje) i **nie** dodajemy walidacji RelaxNG
(`libvirt-python` nie jest w ogóle zależnością novy); żadnego nowego tieru tox,
żadnej masowej redukcji mocków, żadnych release notes (commity testowe miały reno
0/23 w zmierzonym oknie); ranking i kolejność wzięte jako dane — nie relitygowane.

**Fazy** (każda = jeden commit; kolejność ma dwie realne zależności: O3 rebase na
O2, O5 na O4):

| Faza | Jedna linijka | Weryfikacja |
|---|---|---|
| 0 | Zbuduj uruchamialne `stestr` **poza** drzewem submodułu, udowodnij zielone na nietykanym module, utwórz gałąź | auto (5 kroków: import, baseline unit, baseline functional, gałąź, czysty `git status`) + ręcznie (2: baseline failure count zaakceptowany jako podłoga; zero plików w `nova/`) |
| 1 | O1 — przenieś przechwytywanie `_get_guest_config` do `ServersTestBase.setUp` jako `self.guest_configs`, always-on, po UUID; net deletion | auto + ręcznie |
| 2 | O2 — pierwsze asercje dla nogi fatal-timeout, usuń asercję kodującą błędny call shape, napraw mylnie nazwany duplikat | auto + ręcznie |
| 3 | O3 — usuń `_get_pause_flag` (helper przelicza predykat produkcyjny 1:1, więc obie strony ruszają się w lockstepie) | auto + ręcznie |
| 4 | O4 — uszanuj `VIR_DOMAIN_START_PAUSED` w fake'u | auto + ręcznie |
| 5 | O5 — emituj sparsowany machine type i boot device zamiast hardkodów | auto + ręcznie |
| 6 | O6 — dedykowane testy jednostkowe dla `blockinfo.get_disk_info` i `Image.verify_base_size` (dwa commity, moduły niepowiązane) | auto + ręcznie |
| 7 | O7 — dwie poprawki wierności fake'a (`_undefine` rzuca to, co produkcja łapie; `info()` zwraca właściwy typ) | auto + ręcznie |
| 8 | Weryfikacja serii: każdy commit poprawny **osobno** (czego brama per-fazowa nie ustala), plus handoff | auto + ręcznie |

Każda faza ma rozdzielone **Automated Verification** i **Manual Verification**;
Progress w planie jest w całości niezaznaczony (63 kroki `[ ]`) — plan ma status
`plan_reviewed`, implementacja nie startowała. Phase 0 istnieje właśnie dlatego,
że research **nic nie wykonał** — obie jego tezy „zero testów się psuje” są
wyprowadzeniami grep/AST, a nie pomiarem. Faza 0 świadomie łamie guardrail
`nova/AGENTS.md` („nie instaluj brakujących narzędzi pipem”) — decyzja
odnotowana w `plan-brief.md`, venv poza drzewem submodułu.

---

## 5. Domena wg DDD (L5, repo `memq`)

**Ubiquitous language** (wybór z 21-pozycyjnej tabeli):
**Practice Session** — jedna próba odtworzenia algorytmu z pamięci ·
**Move token** — jeden ruch wyodrębniony z sekwencji, porównywany 1:1 ·
**Producible token** — token, który aplikacja *potrafi* wygenerować z klawiatury/
gridu; **pojęcie urodzone w kodzie**, nieobecne w dokumentach, powstało po
incydencie · **Clean run** — ukończona sekwencja z zerem błędów ·
**Forced correction** — brak możliwości pójścia dalej bez poprawnego ruchu.

Najważniejsze rozjazdy model-vs-kod: **R-03** — „walidacja nigdy nie przyjmuje
złego ruchu” istnieje **tylko w przeglądarce**; endpoint bierze
`{algorithmId, isClean, errorCount}` na słowo klienta i nigdy nie widzi
sekwencji. **R-09** — `moves` to wolny `text` bez walidacji; incydent `R2'`/`U2'`
zamroził sesje (bez błędu, bez postępu) i wymagał ręcznej naprawy danych
produkcyjnych poza migracjami. **R-04/R-05** — `practice_sessions` jest zapisywane
i **nigdy nie czytane** przez UI; schema i RLS dla list użytkownika gotowe, ale
brak ścieżki zapisu (dashboard filtruje `is_system = true`). Trzy pojęcia z PRD
(„Repeat or Exit”, duplicate detection, licznik sesji) są **MISSING in code**.
Wniosek o warstwach: **nie ma warstwy domenowej w sensie DDD** — reguła rdzenia
siedzi w komponencie React obok danych layoutu gridu.

**Niezmiennik #1 — INV-01 „attempt integrity”:** zapisana sesja odpowiada
odtworzeniu faktycznie ukończonemu pod forced correction, a jej verdykt
(`clean`/`errors`) jest **wyprowadzony** z tego odtworzenia, nigdy asertowany
przez wołającego. **Agregat: `PracticeAttempt`** (docelowo
`src/lib/domain/practice/PracticeAttempt.ts`, z `AttemptVerdict` konstruowalnym
wyłącznie przez rozstrzygnięty attempt). Dziś reguła jest rozsmarowana na **5
plików / 4 warstwy** i **violable** serwerowo — route sprawdza tylko `typeof`
trzech pól, seam wstawia to, co dostał; nic nie odrzuca
`{isClean: true, errorCount: 5}`. INV-03 (`is_clean ⇔ error_count = 0`), INV-04
(jeden attempt = jeden wiersz) i INV-07 (atomowość) to **sub-niezmienniki tego
samego faktu** i naprawia je ten sam agregat. Kierunek zależności się odwraca:
dziś gramatyka domenowa żyje w `src/test/tokenGrammar.ts` i **importuje z
komponentu UI**, więc kod produkcyjny nie może z niej legalnie korzystać.

**Anti-Corruption Layer — przecieka Axis A: `@supabase/supabase-js` +
`@supabase/ssr`.** **17 wiedzących miejsc przez 7 warstw**: typy globalne
ambient (`src/env.d.ts:3` wstawia vendorowy `User` do globalnego namespace),
middleware, strony SSR, komponenty UI, route'y wire, jedyny moduł domenowy i
wszystkie trzy suity testowe. Trzy najgorsze przecieki: vendorowy
`SupabaseClient<Database>` w **sygnaturze funkcji domenowej**
(`completePractice.ts:46`), surowy SQLSTATE `"23503"` jako **gałąź domenowa**
(`:69`) i `AuthError.message` lądujący w **query stringu URL-a** (`signin.ts:16`).
Wybrane, bo to jedyna zależność obecna w więcej niż dwóch warstwach i jedyna
sięgająca *jednocześnie* warstwy renderowania i domeny — a koszt wymiany jest
„unbounded by design”: nie ma miejsca, które posiada mapowanie. Kontrprzykład w
tym samym repo: `clsx`/`cva`/radix — po jednym wiedzącym pliku każde.

---

## 6. Decyzje, które należą do mnie

AI dostarczyło pomiar i ranking: mapę czterech stref ryzyka, 77-krokowy trace
przepływu spawn, przejście weryfikacyjne ast-grepem (które skorygowało własne
wcześniejsze liczby i obaliło jedną z moich hipotez o mechanizmie zdarzeń async)
oraz trzy tabele niezmienników i przecieków w MemQ. **Ja rozstrzygnąłem
kolejność procesu**: `change.md` dla `refactor-opportunities` explicite rozdziela
eksplorację od decyzji („na etapie eksploracji nie dzieje się żaden refaktor i
nie zapada żadna decyzja”) — najpierw czytam raport, dopiero potem wybieram
zakres. **Ja rozstrzygnąłem zakres i kryterium**: Tier 1 tylko, cross-repo
consumers poza zakresem, weryfikacja przez zbudowanie venva i realne uruchomienie
`stestr` — bo headline'owym ograniczeniem researchu było to, że **nic nie
wykonał**, a jego „zero testów się psuje” to zgadywanie z grepa do momentu
uruchomienia. **Ja rozstrzygnąłem, co pozostaje decyzją człowieka**: push na
Gerrit i zgłoszenie buga na Launchpadzie zostają niewykonane, a Phase 0
świadomie łamie guardrail „no pip” z `nova/AGENTS.md` — z venvem poza drzewem
submodułu, żeby nic nie wpadło do `nova/`. W MemQ dwa dokumenty dały **różne
rankingi** i to ja wybrałem kryterium: `01` stawia `MoveSequence` na #1 według
*value × realized risk* (incydent już się zdarzył), `02` stawia INV-01 według
*core-ness × enforcement gap* — pogodziłem je, dostarczając `MoveSequence` jako
Phase 1 agregatu, bo agregat i tak nie porówna tokenów bez zwalidowanej
gramatyki. Odrzuciłem też uzasadnienie „anti-cheat”: `test-plan.md` słusznie
parkuje forgowanie wyniku jako low impact, więc uzasadnieniem jest integralność
domeny w warunkach **nie**złośliwych (RETRY dopisujący drugi wiersz, `{isClean:
true, errorCount: 5}`, drugi klient redefiniujący „clean” przez przypadek).
