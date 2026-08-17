import os
import time
import glob
import json
import logging
import subprocess
import shutil
import stat
from datetime import datetime, timedelta
from threading import Thread, Lock
import pandas as pd
from flask import Flask, jsonify, send_from_directory, request
from dotenv import load_dotenv
# Carrega as variáveis do arquivo .env
load_dotenv()
import sqlite3

# Define a pasta do projeto primeiro
LOCAL_PROJETO_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(LOCAL_PROJETO_DIR, "banco_dados.db")

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS fichas_manutencao (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                veiculo TEXT NOT NULL,
                data_abertura TEXT NOT NULL,
                hora_abertura TEXT NOT NULL,
                data_fechamento TEXT,
                hora_fechamento TEXT,
                UNIQUE(veiculo, data_abertura, hora_abertura)
            )
        ''')
        conn.commit()

init_db()

# Selenium Imports
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Inicializa o Flask
app = Flask(__name__, static_folder='.', template_folder='.')

# Configurações de pastas dinâmicas (relativas ao arquivo app.py)
LOCAL_PROJETO_DIR = os.path.dirname(os.path.abspath(__file__))
user_home = os.path.expanduser("~")
DOWNLOAD_DIR = os.path.join(user_home, "OneDrive - Nossa Senhora do Ó Participações S.A", "Status em Python")
GECKODRIVER_PATH = os.path.join(LOCAL_PROJETO_DIR, "geckodriver.exe")

# Credenciais protegidas via variáveis de ambiente (.env)
USUARIO_FLITS = os.getenv("USUARIO_FLITS", "")
SENHA_FLITS = os.getenv("SENHA_FLITS", "")
URL_FLITS = "https://flits.cittati.com.br/login"

# Lock de controle
executando_lock = Lock()

# Mapeamento de meses
MESES_PT_REV = {
    "Janeiro": "01", "Fevereiro": "02", "Março": "03", "Abril": "04",
    "Maio": "05", "Junho": "06", "Julho": "07", "Agosto": "08",
    "Setembro": "09", "Outubro": "10", "Novembro": "11", "Dezembro": "12"
}
MESES_PT = {int(v): k for k, v in MESES_PT_REV.items()}

# =====================================================================
#             FUNÇÕES AUXILIARES E LIMPEZA DE TELA
# =====================================================================

def buscar_caminho_firefox():
    caminhos_busca = [
        os.path.join(os.environ.get('USERPROFILE', ''), r"AppData\Local\Mozilla Firefox\firefox.exe"),
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        os.path.join(os.environ.get('LOCALAPPDATA', ''), r"Mozilla Firefox\firefox.exe")
    ]
    for caminho in caminhos_busca:
        if os.path.exists(caminho): return caminho
    return None

def limpar_bloqueios_tela(driver):
    botoes_alvo = ["Entendido", "Aceite", "Aceitar", "Ok", "Fechar"]
    for texto in botoes_alvo:
        try:
            xpath = f"//button[.//span[contains(text(), '{texto}')]] | //button[contains(text(), '{texto}')]"
            elementos = driver.find_elements(By.XPATH, xpath)
            for el in elementos:
                if el.is_displayed():
                    driver.execute_script("arguments[0].click();", el)
                    print(f"     [Limpeza] Pop-up '{texto}' fechado.")
                    time.sleep(1)
        except: pass
    try:
        driver.execute_script("document.querySelectorAll('.ant-modal-wrap, .ant-modal-mask').forEach(el => el.style.display = 'none');")
    except: pass

def enviar_para_github(nome_dados_dia_local):
    try:
        print("[Git] Sincronizando com GitHub...")
        # Mantém apenas a versão mais recente dos dados no Git para não inflar o histórico .git
        arquivos_para_adicionar = ["app.py", "app.js", "index.html", "style.css", "datas.json", "dados.json", nome_dados_dia_local]
        existentes = [a for a in arquivos_para_adicionar if os.path.exists(os.path.join(LOCAL_PROJETO_DIR, a))]
        subprocess.run(["git", "add"] + existentes, cwd=LOCAL_PROJETO_DIR, check=True)
        status = subprocess.run(["git", "status", "--porcelain"], cwd=LOCAL_PROJETO_DIR, capture_output=True, text=True)
        if status.stdout.strip():
            subprocess.run(["git", "commit", "-m", f"Automacao Flits: {datetime.now().strftime('%d/%m %H:%M')}"], cwd=LOCAL_PROJETO_DIR, check=True)
            subprocess.run(["git", "push", "origin", "main"], cwd=LOCAL_PROJETO_DIR, check=True)
            print("[Git] Sincronização automática OK.")
    except Exception as e: print(f"[Git - Erro] {e}")

# =====================================================================
#                 ROTINA DE AUTOMAÇÃO FLITS
# =====================================================================

def iniciar_automacao_flits():
    empresas = [
        "Cidade de Caieiras - Municipal Caieiras",
        "Cidade de Caieiras - Municipal Franco da Rocha",
        "Urubupungá",
        "Urubupungá Municipal Cajamar",
        "Urubupungá Municipal Osasco",
        "Urubupungá Municipal Santana",
        "Viação Cidade Caieiras"
    ]
    situacoes = ["Operando", "Em Manutenção"]
    driver = None
    try:
        options = Options()
        options.add_argument("--headless")
        options.add_argument("--width=1920")
        options.add_argument("--height=1080")
        caminho_f = buscar_caminho_firefox()
        if caminho_f: options.binary_location = caminho_f
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", DOWNLOAD_DIR)
        options.set_preference("browser.download.alwaysOpenPanel", False)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "application/vnd.ms-excel;application/octet-stream")
        
        service = Service(executable_path=GECKODRIVER_PATH)
        driver = webdriver.Firefox(service=service, options=options)
        driver.minimize_window()
        wait = WebDriverWait(driver, 35)

        driver.get(URL_FLITS)
        wait.until(EC.element_to_be_clickable((By.NAME, "username"))).send_keys(USUARIO_FLITS)
        driver.find_element(By.NAME, "password").send_keys(SENHA_FLITS)
        driver.find_element(By.CSS_SELECTOR, "button.btn-login").click()
        time.sleep(8)
        limpar_bloqueios_tela(driver)

        menu = wait.until(EC.presence_of_element_located((By.XPATH, "//div[@data-testid='03'] | //div[@title='Monitoramento']")))
        driver.execute_script("arguments[0].click();", menu)
        time.sleep(2)
        opcao_status = wait.until(EC.presence_of_element_located((By.XPATH, "//div[contains(@class, 'title') and text()='Status Comunicação']")))
        driver.execute_script("arguments[0].click();", opcao_status)
        time.sleep(6)
        limpar_bloqueios_tela(driver)

        btn_f = wait.until(EC.element_to_be_clickable((By.XPATH, "//*[local-name()='svg' and @data-icon='filter']/parent::*")))
        driver.execute_script("arguments[0].click();", btn_f)
        time.sleep(2)

        for sit_alvo in situacoes:
            for idx, emp_nome in enumerate(empresas, 1):
                sucesso_download = False
                tentativas = 0
                
                while not sucesso_download and tentativas < 2:
                    tentativas += 1
                    try:
                        limpar_bloqueios_tela(driver)
                        
                        # Garante que o painel de filtro esteja aberto
                        filtros_abertos = driver.find_elements(By.XPATH, "//div[contains(@class, '_containerOperation_')]")
                        if not filtros_abertos or not filtros_abertos[0].is_displayed():
                            btn_f_open = wait.until(EC.element_to_be_clickable((By.XPATH, "//*[local-name()='svg' and @data-icon='filter']/parent::*")))
                            driver.execute_script("arguments[0].click();", btn_f_open)
                            time.sleep(1.5)

                        box_emp = wait.until(EC.presence_of_element_located((By.XPATH, "//div[contains(@class, '_containerOperation_')]")))
                        driver.execute_script("arguments[0].click();", box_emp)
                        time.sleep(1)
                        ActionChains(driver).send_keys(emp_nome).pause(1.5).send_keys(Keys.ENTER).perform()
                        time.sleep(1.5)

                        box_sit = wait.until(EC.presence_of_element_located((By.XPATH, "//div[@data-testid='Select-situation']//div[contains(@class, 'ant-select-selector')]")))
                        driver.execute_script("arguments[0].click();", box_sit)
                        time.sleep(1)
                        ActionChains(driver).send_keys(sit_alvo).pause(1.5).send_keys(Keys.ENTER).perform()
                        time.sleep(1)

                        btn_submit = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "[data-testid='button-submit']")))
                        driver.execute_script("arguments[0].click();", btn_submit)
                        time.sleep(5)

                        # Verifica se a tela retornou mensagem de "Nenhum dado/registro encontrado"
                        sem_dados = driver.find_elements(By.XPATH, "//*[contains(text(), 'Nenhum registro') or contains(text(), 'Sem dados') or contains(@class, 'ant-empty')]")
                        if sem_dados and any(el.is_displayed() for el in sem_dados):
                            print(f"      - [{emp_nome}] ({sit_alvo}): Sem dados para exportar (0 registros).")
                            sucesso_download = True
                            continue

                        # Se houver dados, localiza o botão de exportar
                        try:
                            btn_excel = WebDriverWait(driver, 5).until(
                                EC.presence_of_element_located((By.XPATH, "//span[@aria-label='file-excel']"))
                            )
                            driver.execute_script("arguments[0].click();", btn_excel)
                            print(f"      - [{emp_nome}] ({sit_alvo}): Download OK.")
                            sucesso_download = True
                            time.sleep(2)
                        except Exception:
                            print(f"      - [{emp_nome}] ({sit_alvo}): Sem botão de exportação (provavelmente sem registros).")
                            sucesso_download = True
                    except Exception as e:
                        if tentativas >= 2:
                            print(f"      - [{emp_nome}] ({sit_alvo}): Erro permanente - ignorando para continuar.")
                        else:
                            time.sleep(3)

        driver.quit()
        processar_e_unificar_arquivos()
        return True
    except Exception as e:
        print(f"[Erro] {e}")
        if driver: driver.quit()
        return False

# =====================================================================
#             PROCESSAMENTO E UNIFICAÇÃO (LIMPEZA DE COLUNAS)
# =====================================================================

def processar_e_unificar_arquivos():
    arquivos = glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx")) + glob.glob(os.path.join(DOWNLOAD_DIR, "*.xls"))
    if not arquivos: return
    
    dados_totais = []
    now = datetime.now()
    data_extracao = now.strftime("%d/%m/%Y")
    hora_extracao = now.strftime("%Hh")
    
    segmentos_avul = ["Urubupungá", "Urubupungá Municipal Osasco", "Urubupungá Municipal Santana", "Urubupungá Municipal Cajamar"]

    # COLUNAS QUE DEVEM SER REMOVIDAS
    colunas_para_ignorar = [
        "Placa", "Firmware do AVUL", "Firmware do AVL", "Último Gps", "Último GPS", 
        "Última transmissão", "Última Transmissão GP", "Ponto", "Validador Status"
    ]

    for arq in arquivos:
        try:
            try: df = pd.read_excel(arq)
            except: df = pd.read_html(arq)[0]

            # Descarta arquivos totalmente vazios
            if df.empty or len(df) == 0:
                os.remove(arq)
                continue

            if "Empresa" in df.iloc[0].values:
                df.columns = df.iloc[0]
                df = df[1:]
            elif "0" in df.columns or isinstance(df.columns[0], (int, float)):
                df.columns = df.iloc[0]
                df = df[1:]

            df = df.fillna("")

            # Descarta se após o cabeçalho não sobraram linhas de veículos
            if df.empty or len(df) == 0:
                os.remove(arq)
                continue
            
            # Remove linhas de cabeçalho duplicadas
            if 'Empresa' in df.columns:
                df = df[df['Empresa'] != 'Empresa']
                
                # 1. Renomeia "Empresa" para "Segmento"
                df = df.rename(columns={'Empresa': 'Segmento'})
                
                # 2. Cria a nova coluna "Empresa" (AVUL/VCCL)
                df['Empresa'] = df['Segmento'].apply(lambda x: "AVUL" if x in segmentos_avul else "VCCL")

            # 3. DESCARTA AS COLUNAS SOLICITADAS
            df = df.drop(columns=[c for c in colunas_para_ignorar if c in df.columns])
            
            lista_registros = df.to_dict(orient='records')
            for registro in lista_registros:
                registro["Data"] = data_extracao
                registro["Hora"] = hora_extracao
            
            dados_totais.extend(lista_registros)
            os.remove(arq)
        except Exception as e: print(f"Erro processar {arq}: {e}")

    if not dados_totais: return

    dia_p, ano_p = now.strftime("%d"), str(now.year)
    mes_n = MESES_PT[now.month]
    diretorio_backup = os.path.join(DOWNLOAD_DIR, ano_p, mes_n, dia_p, now.strftime("%Hh"))
    os.makedirs(diretorio_backup, exist_ok=True)
    with open(os.path.join(diretorio_backup, "status_comunicacao.json"), 'w', encoding='utf-8') as f:
        json.dump(dados_totais, f, ensure_ascii=False, indent=4)
    
    nome_json = f"dados-{now.strftime('%d-%m-%Y')}.json"
    caminho_local = os.path.join(LOCAL_PROJETO_DIR, nome_json)

    # 1. ACÚMULO INTELIGENTE: Mescla registros do dia sem duplicar a mesma hora/veículo
    registros_consolidados = []
    if os.path.exists(caminho_local):
        try:
            with open(caminho_local, 'r', encoding='utf-8') as f_existente:
                registros_consolidados = json.load(f_existente)
        except Exception:
            registros_consolidados = []

    # Remove registros da mesma hora (se for uma re-execução) e anexa a nova extração
    registros_consolidados = [r for r in registros_consolidados if not (r.get("Data") == data_extracao and r.get("Hora") == hora_extracao)]
    registros_consolidados.extend(dados_totais)

    with open(caminho_local, 'w', encoding='utf-8') as f:
        json.dump(registros_consolidados, f, ensure_ascii=False, indent=4)
    
    shutil.copy(caminho_local, os.path.join(LOCAL_PROJETO_DIR, "dados.json"))
    
    datas = set()
    for arq_j in glob.glob(os.path.join(LOCAL_PROJETO_DIR, "dados-*.json")):
        n = os.path.basename(arq_j).replace("dados-", "").replace(".json", "")
        try:
            d, m, a = n.split("-")
            datas.add(f"{d}/{m}/{a}")
        except: pass
    
    lista_ord = sorted(list(datas), key=lambda x: datetime.strptime(x, "%d/%m/%Y"))
    with open(os.path.join(LOCAL_PROJETO_DIR, "datas.json"), 'w', encoding='utf-8') as f:
        json.dump(lista_ord, f, ensure_ascii=False, indent=4)

    enviar_para_github(nome_json)

@app.route('/')
def index(): return send_from_directory('.', 'index.html')
@app.route('/app.js')
def serve_js(): return send_from_directory('.', 'app.js')
@app.route('/style.css')
def serve_css(): return send_from_directory('.', 'style.css')
@app.route('/fichas_manutencao.json')
def serve_fichas():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, veiculo, data_abertura, hora_abertura, data_fechamento, hora_fechamento FROM fichas_manutencao")
        fichas = [dict(row) for row in cursor.fetchall()]
    return jsonify(fichas)

@app.route('/salvar-ficha-item', methods=['POST'])
def salvar_ficha_item():
    dados = request.get_json()
    veiculo = dados.get("veiculo")
    data_ab = dados.get("data_abertura")
    hora_ab = dados.get("hora_abertura")
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR IGNORE INTO fichas_manutencao (veiculo, data_abertura, hora_abertura)
            VALUES (?, ?, ?)
        ''', (veiculo, data_ab, hora_ab))
        conn.commit()
    return jsonify({"status": "sucesso"})

@app.route('/fechar-ficha-item', methods=['POST'])
def fechar_ficha_item():
    dados = request.get_json()
    ficha_id = dados.get("id")
    data_fc = dados.get("data_fechamento")
    hora_fc = dados.get("hora_fechamento")
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE fichas_manutencao 
            SET data_fechamento = ?, hora_fechamento = ?
            WHERE id = ?
        ''', (data_fc, hora_fc, ficha_id))
        conn.commit()
    return jsonify({"status": "sucesso"})
@app.route('/datas.json')
def serve_datas(): return send_from_directory('.', 'datas.json')
@app.route('/dados.json')
def serve_dados(): return send_from_directory('.', 'dados.json')
@app.route('/dados-<data_str>.json')
def serve_dados_hist(data_str): return send_from_directory('.', f"dados-{data_str}.json")

def executar_com_bloqueio(origem="Manual"):
    if not executando_lock.locked():
        with executando_lock:
            print(f"\n>>> Rodada {origem} Iniciada em {datetime.now().strftime('%H:%M:%S')} <<<")
            iniciar_automacao_flits()

def loop_agendamento():
    while True:
        agora = datetime.now()
        alvos = [7, 22, 37, 52]
        prox = [agora.replace(minute=m, second=0, microsecond=0) for m in alvos]
        espera = (min([p if p > agora else p + timedelta(hours=1) for p in prox]) - agora).total_seconds()
        time.sleep(espera)
        executar_com_bloqueio("Agendada")

if __name__ == '__main__':
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    Thread(target=lambda: app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False), daemon=True).start()
    Thread(target=executar_com_bloqueio, args=("Inicial",), daemon=True).start()
    def escuta():
        while True:
            try: input(); Thread(target=executar_com_bloqueio, args=("Manual",), daemon=True).start()
            except EOFError: break
    Thread(target=escuta, daemon=True).start()
    loop_agendamento()