import os
import time
import glob
import json
import subprocess
from datetime import datetime, timedelta
from threading import Thread, Lock
import pandas as pd
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

# Configurações de pastas e arquivos locais
# Detecta automaticamente a pasta de usuário do Windows logado na máquina
user_home = os.path.expanduser("~")
DOWNLOAD_DIR = os.path.join(user_home, "OneDrive - Nossa Senhora do Ó Participações S.A", "Status em Python")
GECKODRIVER_PATH = r"C:\Projetos em Python\Status em Python\geckodriver.exe"
LOCAL_PROJETO_DIR = r"C:\Projetos em Python\Status em Python"

# Credenciais do sistema Cittati
USUARIO_GOOL = "status.nso"
SENHA_GOOL = "@Cmi123"

# Lock de controle para evitar conflito de concorrência
executando_lock = Lock()

# Dicionários de mapeamento de meses para controle de caminhos
MESES_PT_REV = {
    "Janeiro": "01", "Fevereiro": "02", "Março": "03", "Abril": "04",
    "Maio": "05", "Junho": "06", "Julho": "07", "Agosto": "08",
    "Setembro": "09", "Outubro": "10", "Novembro": "11", "Dezembro": "12"
}
MESES_PT = {int(v): k for k, v in MESES_PT_REV.items()}

# =====================================================================
#             FUNÇÕES DE INTEGRAÇÃO COM GITHUB
# =====================================================================

def enviar_para_github():
    """Executa comandos git de commit e push de forma silenciosa para o GitHub."""
    try:
        print("[Git] Escaneando e adicionando arquivos de dados modificados...")
        # Adiciona somente os arquivos estruturados do dashboard e código front
        subprocess.run(["git", "add", "datas.json", "dados.json", "dados-*.json", "index.html", "app.js", "style.css"], cwd=LOCAL_PROJETO_DIR, check=True)
        
        # Verifica se há realmente alguma alteração para comitar
        status = subprocess.run(["git", "status", "--porcelain"], cwd=LOCAL_PROJETO_DIR, capture_output=True, text=True)
        if not status.stdout.strip():
            print("[Git] Nenhuma alteração de dados encontrada para comitar.")
            return
            
        print("[Git] Criando commit de dados...")
        subprocess.run(["git", "commit", "-m", "Automacao: Atualizacao horaria de dados"], cwd=LOCAL_PROJETO_DIR, check=True)
        
        print("[Git] Enviando alterações ao GitHub remoto...")
        subprocess.run(["git", "push", "origin", "main"], cwd=LOCAL_PROJETO_DIR, check=True)
        print("[Git] Sincronização com o GitHub concluída.")
    except Exception as e:
        print(f"[Git - Erro] Falha ao sincronizar dados com o GitHub: {e}")

# =====================================================================
#                 ROTINA DO ROBO AUTOMATIZADO (SELENIUM)
# =====================================================================

def buscar_caminho_firefox():
    caminhos_provaveis = [
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Mozilla Firefox\firefox.exe")
    ]
    for caminho in caminhos_provaveis:
        if os.path.exists(caminho):
            return caminho
    return None

def obter_arquivos_existentes():
    return set(glob.glob(os.path.join(DOWNLOAD_DIR, "*")))

def aguardar_loadmask(driver, timeout=15):
    try:
        WebDriverWait(driver, timeout).until(
            EC.invisibility_of_element_located((By.XPATH, "//*[contains(@class, 'loadmask')]"))
        )
        time.sleep(1)
    except:
        pass

def aguardar_conclusao_download(diretorio, conjunto_arquivos_antigo, timeout=45):
    tempo_limite = time.time() + timeout
    while time.time() < tempo_limite:
        arquivos_atuais = set(glob.glob(os.path.join(diretorio, "*")))
        arquivos_temporarios = [f for f in arquivos_atuais if f.endswith(".part") or f.endswith(".tmp")]
        
        if not arquivos_temporarios:
            novos_arquivos = arquivos_atuais - conjunto_arquivos_antigo
            novos_reais = [f for f in novos_arquivos if os.path.isfile(f) and f.endswith(('.xls', '.xlsx'))]
            if novos_reais:
                return True
        time.sleep(1)
    return False

def selecionar_empresa_com_postback(driver, value):
    wait = WebDriverWait(driver, 15)
    select_id = "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa"
    
    aguardar_loadmask(driver)
    select_element = wait.until(EC.element_to_be_clickable((By.ID, select_id)))
    select = Select(select_element)
    select.select_by_value(value)
    
    time.sleep(2)
    aguardar_loadmask(driver)
    wait.until(EC.element_to_be_clickable((By.ID, select_id)))

def carregar_dados_xls(caminho_arquivo):
    try:
        df = pd.read_excel(caminho_arquivo)
        return df
    except Exception as e_xls:
        try:
            dfs = pd.read_html(caminho_arquivo)
            if dfs:
                return dfs[0]
        except Exception as e_html:
            pass
    return None

def processar_e_unificar_arquivos():
    """Lê planilhas, salva individual na pasta de hora, gera o unificado local e o envia ao GitHub."""
    padrao_busca = os.path.join(DOWNLOAD_DIR, "pesquisar status de comunicação*.xls")
    arquivos_xls = glob.glob(padrao_busca)
    
    if not arquivos_xls:
        return False, "Nenhum arquivo XLS temporário na raiz para processar."
        
    dados_da_hora_atual = []
    print(f"\n--- Iniciando processamento de {len(arquivos_xls)} arquivo(s) XLS ---")
    
    for caminho_arquivo in arquivos_xls:
        nome_curto = os.path.basename(caminho_arquivo)
        df = carregar_dados_xls(caminho_arquivo)
        if df is not None:
            df = df.fillna("")
            dados_planilha = df.to_dict(orient='records')
            dados_da_hora_atual.extend(dados_planilha)
            print(f"-> {len(dados_planilha)} registros extraídos de {nome_curto}.")
        else:
            print(f"-> Falha ao extrair dados de: {nome_curto}.")
            
    # Define diretório específico de hora para backup no OneDrive
    now = datetime.now()
    ano = str(now.year)
    mes_nome = MESES_PT[now.month]
    dia_str = f"{now.day:02d}"
    hora_str = f"{now.hour:02d}h"
    
    diretorio_hora = os.path.join(DOWNLOAD_DIR, ano, mes_nome, dia_str, hora_str)
    os.makedirs(diretorio_hora, exist_ok=True)
    
    caminho_json_hora = os.path.join(diretorio_hora, "status_comunicacao.json")
    with open(caminho_json_hora, 'w', encoding='utf-8') as f:
        json.dump(dados_da_hora_atual, f, ensure_ascii=False, indent=4)
    print(f"[Backup OneDrive] Salvo arquivo individual da hora em: {caminho_json_hora}")
    
    # UNIFICAÇÃO FÍSICA PARA O GITHUB (Sempre atualiza de hora em hora para o Cloudflare estar em dia)
    diretorio_dia = os.path.join(DOWNLOAD_DIR, ano, mes_nome, dia_str)
    padrao_horas_dia = os.path.join(diretorio_dia, "*h", "status_comunicacao.json")
    arquivos_horas = glob.glob(padrao_horas_dia)
    
    todos_dados_dia = []
    print(f"[Dashboard] Consolidando {len(arquivos_horas)} horas de dados para envio ao GitHub...")
    
    for arq_hora in arquivos_horas:
        try:
            nome_pasta_hora = os.path.basename(os.path.dirname(arq_hora))
            with open(arq_hora, 'r', encoding='utf-8') as f:
                registros_hora = json.load(f)
                for r in registros_hora:
                    r["_data_pasta"] = f"{dia_str}/{now.month:02d}/{ano}"  # Formato dd/mm/aaaa
                    r["_hora_pasta"] = nome_pasta_hora
                todos_dados_dia.extend(registros_hora)
        except Exception as e:
            print(f"[Erro] Falha ao ler arquivo de hora {arq_hora}: {e}")
            
    # Cria o unificado físico definitivo apenas nas execuções das 23h na pasta do OneDrive (backup)
    if now.hour == 23:
        nome_unificado = f"unificado_{dia_str}-{now.month:02d}-{ano}.json"
        caminho_unificado_salvo = os.path.join(diretorio_dia, nome_unificado)
        with open(caminho_unificado_salvo, 'w', encoding='utf-8') as f:
            json.dump(todos_dados_dia, f, ensure_ascii=False, indent=4)
        print(f"[Backup OneDrive] Unificação das 23h salva em: {caminho_unificado_salvo}")
        
    # Salva os arquivos de dados locais utilizados pelo painel do Cloudflare (dados.json e dados-dia.json)
    caminho_dados_dia_local = os.path.join(LOCAL_PROJETO_DIR, f"dados-{dia_str}-{now.month:02d}-{ano}.json")
    with open(caminho_dados_dia_local, 'w', encoding='utf-8') as f:
        json.dump(todos_dados_dia, f, ensure_ascii=False, indent=4)
        
    caminho_dados_atual_local = os.path.join(LOCAL_PROJETO_DIR, "dados.json")
    with open(caminho_dados_atual_local, 'w', encoding='utf-8') as f:
        json.dump(todos_dados_dia, f, ensure_ascii=False, indent=4)
        
    # Atualiza o arquivo de datas disponíveis com base nos arquivos locais existentes
    datas_disponiveis = set()
    for arq_local in glob.glob(os.path.join(LOCAL_PROJETO_DIR, "dados-*.json")):
        nome_base = os.path.basename(arq_local)
        parte_data = nome_base.replace("dados-", "").replace(".json", "")
        try:
            d, m, a = parte_data.split("-")
            datas_disponiveis.add(f"{d}/{m}/{a}")
        except:
            pass
            
    lista_datas_ordenada = sorted(list(datas_disponiveis), key=lambda x: datetime.strptime(x, "%d/%m/%Y"))
    caminho_datas_local = os.path.join(LOCAL_PROJETO_DIR, "datas.json")
    with open(caminho_datas_local, 'w', encoding='utf-8') as f:
        json.dump(lista_datas_ordenada, f, ensure_ascii=False, indent=4)
        
    # Deleta as planilhas XLS temporárias da raiz
    for caminho_arquivo in arquivos_xls:
        try:
            os.remove(caminho_arquivo)
        except:
            pass
            
    # Executa a sincronização silenciosa com o seu repositório do GitHub
    enviar_para_github()
    
    return True, caminho_dados_dia_local

def imprimir_tabela_logs(logs):
    print("\n" + "="*85)
    print("                      RELATÓRIO DE EXPORTAÇÃO DE ARQUIVOS")
    print("="*85)
    print(f"{'Empresa':<45} | {'Situação':<15} | {'Status'}")
    print("-" * 85)
    for log in logs:
        empresa_truncada = log['empresa'][:45]
        print(f"{empresa_truncada:<45} | {log['situacao']:<15} | {log['status']}")
    print("="*85 + "\n")

def executar_ciclo_pesquisa(driver, situacao_nome, logs):
    wait = WebDriverWait(driver, 15)
    
    select_empresa_el = wait.until(EC.presence_of_element_located((By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa")))
    select_empresa = Select(select_empresa_el)
    empresas = [opt.get_attribute("value") for opt in select_empresa.options if opt.get_attribute("value") != "0"]
    
    for valor_empresa in empresas:
        select_empresa_el = driver.find_element(By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlEmpresa")
        select_temp = Select(select_empresa_el)
        texto_empresa = next(opt.text for opt in select_temp.options if opt.get_attribute("value") == valor_empresa)
        
        try:
            selecionar_empresa_com_postback(driver, valor_empresa)
            aguardar_loadmask(driver)
            
            btn_pesquisar = wait.until(EC.element_to_be_clickable(
                (By.XPATH, "//p[contains(@class, 'iconePesquisar') or contains(text(), 'Pesquisar')]")
            ))
            btn_pesquisar.click()
            
            time.sleep(1.5)
            aguardar_loadmask(driver)
            
            try:
                excel_button = WebDriverWait(driver, 30).until(
                    EC.element_to_be_clickable((By.XPATH, "//input[contains(@src, 'icon-doc-excel.gif')]"))
                )
            except:
                excel_button = None
            
            if not excel_button:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                continue
            
            arquivos_antes = obter_arquivos_existentes()
            excel_button.click()
            time.sleep(1.5)
            
            try:
                alert = driver.switch_to.alert
                alert.accept()
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                continue
            except:
                pass
            
            sucesso_download = aguardar_conclusao_download(DOWNLOAD_DIR, arquivos_antes, timeout=45)
            
            if sucesso_download:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Exportado com Sucesso"})
                time.sleep(1)
            else:
                logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})
                
        except:
            logs.append({"empresa": texto_empresa, "situacao": situacao_nome, "status": "Falta de Informação"})

def iniciar_automacao():
    logs_execucao = []
    
    try:
        options = Options()
        caminho_firefox = buscar_caminho_firefox()
        if not caminho_firefox:
            print("[Erro] Não foi possível encontrar o Firefox instalado.")
            return False
        
        options.binary_location = caminho_firefox
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", DOWNLOAD_DIR)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "application/vnd.ms-excel;application/octet-stream;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        options.set_preference("browser.download.manager.showWhenStarting", False)
        options.set_preference("dom.allow_multiple_downloads", True)
        options.set_preference("browser.download.useDownloadDir", True)
        
        service = Service(executable_path=GECKODRIVER_PATH)
        driver = webdriver.Firefox(service=service, options=options)
        
        # 1. Acessa o Portal GOOL
        driver.get("https://gool.cittati.com.br/Login.aspx?ReturnUrl=%2f")
        wait = WebDriverWait(driver, 15)
        
        # 2. Seleciona o módulo Urbano
        btn_urbano = wait.until(EC.element_to_be_clickable((By.ID, "ucTrocarModulo_btnIconeUrbano")))
        btn_urbano.click()
        time.sleep(2)
        
        # 3. Realiza o login (senha fixa)
        campo_usuario = wait.until(EC.visibility_of_element_located((By.ID, "ucLogarUsuario_txtLogin")))
        campo_usuario.clear()
        campo_usuario.send_keys(USUARIO_GOOL)
        
        campo_senha = wait.until(EC.visibility_of_element_located((By.ID, "ucLogarUsuario_txtSenha")))
        campo_senha.clear()
        campo_senha.send_keys(SENHA_GOOL)
        
        btn_logar = wait.until(EC.element_to_be_clickable((By.ID, "ucLogarUsuario_btnLogar")))
        btn_logar.click()
        
        # 4. Acessa "Status de Comunicação"
        btn_status_comunicacao = wait.until(EC.element_to_be_clickable((By.XPATH, "//span[@title='Status de Comunicação']")))
        btn_status_comunicacao.click()
        time.sleep(4)
        
        # --- CICLO 1: Veículos em situação "Operando" ---
        executar_ciclo_pesquisa(driver, "Operando", logs_execucao)
        
        # --- CICLO 2: Veículos em situação "Em Manutenção" ---
        aguardar_loadmask(driver)
        select_situacao_el = wait.until(EC.element_to_be_clickable((By.ID, "ContentPlaceHolder1_contentFiltroPesquisa_ddlSituacaoVeiculo")))
        select_situacao = Select(select_situacao_el)
        select_situacao.select_by_value("M")
        
        time.sleep(2)
        aguardar_loadmask(driver)
        
        executar_ciclo_pesquisa(driver, "Em Manutenção", logs_execucao)
        
        # Fecha o navegador
        driver.quit()
        
        # --- PROCESSO DE UNIFICAÇÃO ---
        sucesso_unificacao, resultado_unificacao = processar_e_unificar_arquivos()
        
        imprimir_tabela_logs(logs_execucao)
        if sucesso_unificacao:
            print(f"[Sucesso] Arquivo de dados sincronizado localmente: {resultado_unificacao}")
        else:
            print(f"[Aviso] {resultado_unificacao}")
            
        return True
    except Exception as e:
        print(f"[Erro Geral] Falha na execução da rotina: {e}")
        return False

def executar_com_bloqueio(origem="Manual"):
    """Controle de Lock para que o agendador e o clique manual não conflitem."""
    if executando_lock.locked():
        print(f"\n[Aviso] O robô já está executando uma tarefa. Clique '{origem}' desconsiderado.")
        return
        
    with executando_lock:
        print(f"\n>>> Iniciando tarefa automática ({origem}) às {datetime.now().strftime('%H:%M:%S')} >>>")
        iniciar_automacao()

# =====================================================================
#             ROUTINES DO AGENDADOR E CONTROLES DE TERMINAL
# =====================================================================

def escutar_teclado():
    """Escuta do terminal PowerShell: Permite ao usuário clicar ENTER para rodar manualmente."""
    while True:
        input()
        Thread(target=executar_com_bloqueio, args=("Manual",), daemon=True).start()

def obter_segundos_ate_minuto_5():
    agora = datetime.now()
    proximo = agora.replace(minute=5, second=0, microsecond=0)
    if proximo <= agora:
        proximo += timedelta(hours=1)
    return (proximo - agora).total_seconds()

def loop_agendamento():
    while True:
        segundos_espera = obter_segundos_ate_minuto_5()
        proximo_horario = datetime.now() + timedelta(seconds=segundos_espera)
        print(f"[Agendador] Próxima execução programada para: {proximo_horario.strftime('%d/%m/%Y %H:%M:%S')}")
        
        tempo_limite = time.time() + segundos_espera
        while time.time() < tempo_limite:
            time.sleep(1)
            
        executar_com_bloqueio("Agendada")

if __name__ == '__main__':
    # Roda a primeira automação de dados imediatamente
    Thread(target=executar_com_bloqueio, args=("Manual Inicial",), daemon=True).start()
    
    # Escuta do teclado para execuções manuais intermediárias
    Thread(target=escutar_teclado, daemon=True).start()
    
    # Mantém o loop de agendamento permanente no minuto 5
    loop_agendamento()